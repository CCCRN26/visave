import bcrypt from "bcryptjs";
import { pool } from "@/lib/db/pool";
import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import {
  AppError,
  AuthorizationError,
  ConflictError,
  NotFoundError,
} from "@/lib/errors";
import * as repository from "./facilitator.repository";
import { validateLocationHierarchy } from "@/modules/locations/location.service";

const domainError = (code, message, status = 409, details) =>
  new AppError(message, code, status, details);

async function requireActorScope(client, actor, projectId, stateId) {
  if (actor.roles.includes("SUPER_ADMIN")) return;
  const allowed = (
    await client.query(
      `SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND ur.project_id=$2 AND (ur.state_id IS NULL OR ur.state_id=$3) AND r.code IN('PROJECT_ADMIN','STATE_COORDINATOR')`,
      [actor.id, projectId, stateId],
    )
  ).rowCount;
  if (!allowed) throw new AuthorizationError();
}

async function validateScope(client, actor, projectId, stateId, lgaId) {
  await requireActorScope(client, actor, projectId, stateId);
  await validateLocationHierarchy(client, { stateId, lgaId, communityId: null });
  const scope = await repository.scope(
    client,
    actor.organization_id,
    projectId,
    stateId,
    lgaId,
  );
  if (!scope) {
    const foreignProject = (
      await client.query(
        "SELECT 1 FROM projects WHERE id=$1 AND organization_id<>$2",
        [projectId, actor.organization_id],
      )
    ).rowCount;
    if (foreignProject) throw new AuthorizationError();
    throw domainError(
      "INVALID_FACILITATOR_SCOPE",
      "The project or geographic scope is invalid",
      400,
    );
  }
  return scope;
}

async function validateGroups(client, actor, scope, groupIds) {
  if (!groupIds.length) return [];
  const groups = await repository.compatibleGroups(
    client,
    actor.organization_id,
    scope.project_id,
    scope.state_id,
    scope.lga_id,
    groupIds,
  );
  if (groups.length !== new Set(groupIds).size)
    throw domainError(
      "GROUP_OUTSIDE_FACILITATOR_SCOPE",
      "One or more groups are outside the facilitator scope",
      400,
    );
  return groups;
}

async function assignLocked(client, facilitator, groups, actor, reason = null) {
  for (const group of groups) {
    const oldUserId = group.facilitator_user_id;
    if (oldUserId === facilitator.user_id) continue;
    await client.query(
      "UPDATE vsla_groups SET facilitator_user_id=$2,updated_at=now() WHERE id=$1",
      [group.id, facilitator.user_id],
    );
    const replacementProfileId=facilitator.id||(await client.query('SELECT id FROM facilitator_profiles WHERE user_id=$1',[facilitator.user_id])).rows[0]?.id;
    if(replacementProfileId){const moved=(await client.query(`UPDATE vsla_join_requests SET assigned_facilitator_id=$2,updated_at=now() WHERE group_id=$1 AND status IN('SUBMITTED','VIEWED','CONTACTED','UNDER_GROUP_REVIEW','WAITLISTED','APPROVED_FOR_NEXT_CYCLE') RETURNING id`,[group.id,replacementProfileId])).rows;for(const request of moved){await client.query(`UPDATE notifications SET recipient_user_id=$2 WHERE entity_type='VSLA_JOIN_REQUEST' AND entity_id=$1 AND NOT is_read`,[request.id,facilitator.user_id]);await writeAudit(client,{organizationId:actor.organization_id,actorUserId:actor.id,action:'JOIN_REQUEST_REASSIGNED_TO_AGENT',entityType:'VSLA_JOIN_REQUEST',entityId:request.id,newValues:{facilitatorProfileId:replacementProfileId}})}}
    await writeAudit(client, {
      organizationId: actor.organization_id,
      actorUserId: actor.id,
      action: oldUserId
        ? "GROUP_FACILITATOR_REASSIGNED"
        : "GROUP_ASSIGNED_TO_FACILITATOR",
      entityType: "VSLA_GROUP",
      entityId: group.id,
      oldValues: { facilitatorUserId: oldUserId },
      newValues: { facilitatorUserId: facilitator.user_id, reason: reason || undefined },
    });
  }
}

function translateConstraint(error) {
  if (error?.code !== "23505") throw error;
  if (error.constraint === "users_org_email_unique")
    throw domainError(
      "USER_EMAIL_ALREADY_EXISTS",
      "A user with this email already exists",
    );
  if (error.constraint === "facilitator_profiles_staff_code_key")
    throw domainError(
      "FACILITATOR_CODE_EXISTS",
      "This facilitator code already exists",
    );
  throw new ConflictError();
}

export async function listFacilitators(actor, filters) {
  return repository.list(pool, actor, filters);
}

export async function getFacilitator(id, actor) {
  const value = await repository.detail(pool, id, actor.organization_id);
  if (!value)
    throw domainError("FACILITATOR_NOT_FOUND", "Facilitator not found", 404);
  await requireActorScope(
    pool,
    actor,
    value.facilitator.project_id,
    value.facilitator.state_id,
  );
  return value;
}

export async function createFacilitator(data, actor) {
  try {
    return await withTransaction(async (client) => {
      const scope = await validateScope(
        client,
        actor,
        data.projectId,
        data.stateId,
        data.lgaId,
      );
      const groups = await validateGroups(client, actor, scope, data.groupIds);
      const passwordHash = await bcrypt.hash(data.password, 12);
      const user = (
        await client.query(
          `INSERT INTO users(organization_id,first_name,last_name,email,phone,password_hash,status,must_change_password,created_by) VALUES($1,$2,$3,$4,$5,$6,'ACTIVE',true,$7) RETURNING id,organization_id,first_name,last_name,email,phone,status,created_at`,
          [
            actor.organization_id,
            data.firstName,
            data.lastName,
            data.email,
            data.phone || null,
            passwordHash,
            actor.id,
          ],
        )
      ).rows[0];
      const profile = (
        await client.query(
          `INSERT INTO facilitator_profiles(user_id,staff_code,state_id,lga_id,status) VALUES($1,$2,$3,$4,'ACTIVE') RETURNING *`,
          [user.id, data.staffCode, data.stateId, data.lgaId || null],
        )
      ).rows[0];
      const role = (
        await client.query(
          `INSERT INTO user_roles(user_id,role_id,project_id,state_id,created_by) SELECT $1,r.id,$2,$3,$4 FROM roles r WHERE r.code='FACILITATOR' RETURNING *`,
          [user.id, data.projectId, data.stateId, actor.id],
        )
      ).rows[0];
      if (!role) throw new Error("FACILITATOR role is missing");
      await assignLocked(client, { user_id: user.id }, groups, actor);
      await writeAudit(client, {
        organizationId: actor.organization_id,
        actorUserId: actor.id,
        action: "FACILITATOR_CREATED",
        entityType: "FACILITATOR_PROFILE",
        entityId: profile.id,
        newValues: {
          userId: user.id,
          staffCode: profile.staff_code,
          projectId: data.projectId,
          stateId: data.stateId,
          lgaId: data.lgaId || null,
          groupIds: groups.map((group) => group.id),
        },
      });
      return repository.detail(client, profile.id, actor.organization_id);
    });
  } catch (error) {
    translateConstraint(error);
  }
}

export async function updateFacilitator(id, data, actor) {
  try {
    return await withTransaction(async (client) => {
      const current = await repository.detail(
        client,
        id,
        actor.organization_id,
        true,
      );
      if (!current)
        throw domainError(
          "FACILITATOR_NOT_FOUND",
          "Facilitator not found",
          404,
        );
      const projectId = data.projectId || current.facilitator.project_id;
      const stateId = data.stateId || current.facilitator.state_id;
      const lgaId = Object.hasOwn(data, "lgaId")
        ? data.lgaId
        : current.facilitator.lga_id;
      await validateScope(client, actor, projectId, stateId, lgaId);
      const conflicts = current.groups.filter(
        (group) =>
          group.status !== "ARCHIVED" &&
          (group.project_id !== projectId ||
            group.state_id !== stateId ||
            (lgaId && group.lga_id !== lgaId)),
      );
      if (conflicts.length)
        throw domainError(
          "FACILITATOR_SCOPE_CONFLICT",
          "The facilitator has assigned groups outside the requested new scope",
          409,
          {
            groups: conflicts.map(
              ({ id: groupId, group_code: code, name }) => ({
                id: groupId,
                code,
                name,
              }),
            ),
          },
        );
      await client.query(
        `UPDATE users SET first_name=COALESCE($2,first_name),last_name=COALESCE($3,last_name),email=COALESCE($4,email),phone=COALESCE($5,phone),updated_at=now() WHERE id=$1`,
        [
          current.facilitator.user_id,
          data.firstName,
          data.lastName,
          data.email,
          data.phone,
        ],
      );
      await client.query(
        `UPDATE facilitator_profiles SET staff_code=COALESCE($2,staff_code),state_id=$3,lga_id=$4,updated_at=now() WHERE id=$1`,
        [id, data.staffCode, stateId, lgaId],
      );
      await client.query(
        `UPDATE user_roles ur SET project_id=$2,state_id=$3 FROM roles r WHERE ur.role_id=r.id AND r.code='FACILITATOR' AND ur.user_id=$1`,
        [current.facilitator.user_id, projectId, stateId],
      );
      await writeAudit(client, {
        organizationId: actor.organization_id,
        actorUserId: actor.id,
        action: "FACILITATOR_UPDATED",
        entityType: "FACILITATOR_PROFILE",
        entityId: id,
        oldValues: current.facilitator,
        newValues: { ...data, projectId, stateId, lgaId },
      });
      return repository.detail(client, id, actor.organization_id);
    });
  } catch (error) {
    translateConstraint(error);
  }
}

export async function assignGroups(id, data, actor) {
  return withTransaction(async (client) => {
    const value = await repository.detail(
      client,
      id,
      actor.organization_id,
      true,
    );
    if (!value)
      throw domainError("FACILITATOR_NOT_FOUND", "Facilitator not found", 404);
    if (value.facilitator.status !== "ACTIVE")
      throw domainError(
        "FACILITATOR_INACTIVE",
        "Groups cannot be assigned to an inactive facilitator",
      );
    await requireActorScope(
      client,
      actor,
      value.facilitator.project_id,
      value.facilitator.state_id,
    );
    const groups = await validateGroups(
      client,
      actor,
      {
        project_id: value.facilitator.project_id,
        state_id: value.facilitator.state_id,
        lga_id: value.facilitator.lga_id,
      },
      data.groupIds,
    );
    const reassignments = groups.filter((group) => group.facilitator_user_id && group.facilitator_user_id !== value.facilitator.user_id);
    if (reassignments.length && !data.reassignmentReason)
      throw domainError("AGENT_REASSIGNMENT_REASON_REQUIRED", "A reason is required when reassigning a group", 422);
    const selected = new Set(data.groupIds);
    const removals = value.groups.filter((group) => !selected.has(group.id));
    const blocked = removals.filter((group) => group.operation_mode === "PROGRAM_ASSISTED" && ["ACTIVE", "SUSPENDED"].includes(group.status));
    if (blocked.length)
      throw domainError("ACTIVE_GROUP_REPLACEMENT_REQUIRED", "Operational Programme-Assisted groups must be reassigned, not left without an Agent", 409, { groups: blocked.map(({ id: groupId, group_code: code, name }) => ({ id: groupId, code, name })) });
    if (removals.length)
      await client.query("UPDATE vsla_groups SET facilitator_user_id=NULL,updated_at=now() WHERE id=ANY($1::uuid[])", [removals.map((group) => group.id)]);
    await assignLocked(client, value.facilitator, groups, actor, data.reassignmentReason || null);
    return repository.detail(client, id, actor.organization_id);
  });
}

export async function deactivateFacilitator(id, data, actor) {
  return withTransaction(async (client) => {
    const current = await repository.detail(
      client,
      id,
      actor.organization_id,
      true,
    );
    if (!current)
      throw domainError("FACILITATOR_NOT_FOUND", "Facilitator not found", 404);
    if (current.facilitator.user_id === actor.id)
      throw domainError(
        "SELF_DEACTIVATION_NOT_ALLOWED",
        "You cannot deactivate your own active account",
        400,
      );
    await requireActorScope(
      client,
      actor,
      current.facilitator.project_id,
      current.facilitator.state_id,
    );
    const activeGroups = current.groups.filter(
      (group) => !["ARCHIVED", "CLOSED"].includes(group.status),
    );
    let replacement;
    if (activeGroups.length) {
      if (!data.replacementFacilitatorId)
        throw domainError(
          "FACILITATOR_HAS_ACTIVE_GROUPS",
          "Reassign active groups before deactivation",
          409,
          {
            groups: activeGroups.map((group) => ({
              id: group.id,
              code: group.group_code,
              name: group.name,
            })),
          },
        );
      const replacementValue = await repository.detail(
        client,
        data.replacementFacilitatorId,
        actor.organization_id,
        true,
      );
      replacement = replacementValue?.facilitator;
      if (
        !replacement ||
        replacement.id === id ||
        replacement.status !== "ACTIVE" ||
        replacement.project_id !== current.facilitator.project_id ||
        replacement.state_id !== current.facilitator.state_id ||
        (replacement.lga_id &&
          activeGroups.some((group) => group.lga_id !== replacement.lga_id))
      )
        throw domainError(
          "INVALID_REPLACEMENT_FACILITATOR",
          "Replacement facilitator is inactive or outside the required scope",
          400,
        );
      await assignLocked(client, replacement, activeGroups, actor);
    }
    await client.query(
      "UPDATE facilitator_profiles SET status='INACTIVE',updated_at=now() WHERE id=$1",
      [id],
    );
    await client.query(
      "UPDATE users SET status='INACTIVE',updated_at=now() WHERE id=$1",
      [current.facilitator.user_id],
    );
    await client.query(
      "UPDATE user_sessions SET revoked_at=COALESCE(revoked_at,now()) WHERE user_id=$1",
      [current.facilitator.user_id],
    );
    await writeAudit(client, {
      organizationId: actor.organization_id,
      actorUserId: actor.id,
      action: "FACILITATOR_DEACTIVATED",
      entityType: "FACILITATOR_PROFILE",
      entityId: id,
      oldValues: {
        status: current.facilitator.status,
        activeGroups: activeGroups.length,
      },
      newValues: {
        status: "INACTIVE",
        replacementFacilitatorId: replacement?.id || null,
      },
    });
    return repository.detail(client, id, actor.organization_id);
  });
}

export async function activateFacilitator(id, actor) {
  return withTransaction(async (client) => {
    const current = await repository.detail(
      client,
      id,
      actor.organization_id,
      true,
    );
    if (!current)
      throw domainError("FACILITATOR_NOT_FOUND", "Facilitator not found", 404);
    await requireActorScope(
      client,
      actor,
      current.facilitator.project_id,
      current.facilitator.state_id,
    );
    await validateScope(
      client,
      actor,
      current.facilitator.project_id,
      current.facilitator.state_id,
      current.facilitator.lga_id,
    );
    await client.query(
      "UPDATE users SET status='ACTIVE',updated_at=now() WHERE id=$1",
      [current.facilitator.user_id],
    );
    await client.query(
      "UPDATE facilitator_profiles SET status='ACTIVE',updated_at=now() WHERE id=$1",
      [id],
    );
    await writeAudit(client, {
      organizationId: actor.organization_id,
      actorUserId: actor.id,
      action: "FACILITATOR_ACTIVATED",
      entityType: "FACILITATOR_PROFILE",
      entityId: id,
      oldValues: { status: current.facilitator.status },
      newValues: { status: "ACTIVE" },
    });
    return repository.detail(client, id, actor.organization_id);
  });
}
