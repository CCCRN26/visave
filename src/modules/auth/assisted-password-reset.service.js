import bcrypt from "bcryptjs";
import { randomInt } from "node:crypto";
import { pool } from "@/lib/db/pool";
import { runTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, AuthorizationError, NotFoundError } from "@/lib/errors";
import { revokeUserSessions } from "./auth.repository.js";
import { BCRYPT_COST, PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "./password-policy.js";
import { assertUserInManagementScope, highestManagementRole } from "@/modules/users/user-access.service";
import { assertGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { TURNSTILE_ACTIONS, verifyTurnstileToken } from "@/lib/security/turnstile";

const TEMPORARY_PASSWORD_LENGTH = 20;
const CHARACTER_GROUPS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
  "!@#$%&*+-=?",
];
const ALL_CHARACTERS = CHARACTER_GROUPS.join("");
const RESETTABLE_ROLES = {
  PROJECT_ADMIN: new Set(["PROJECT_ADMIN", "STATE_COORDINATOR", "FACILITATOR", "VSLA_MEMBER"]),
  STATE_COORDINATOR: new Set(["STATE_COORDINATOR", "FACILITATOR", "VSLA_MEMBER"]),
};

const resetError = (message, code, status = 409) => new AppError(message, code, status);

export function generateTemporaryPassword(randomInteger = randomInt) {
  const characters = CHARACTER_GROUPS.map((group) => group[randomInteger(group.length)]);
  while (characters.length < TEMPORARY_PASSWORD_LENGTH) characters.push(ALL_CHARACTERS[randomInteger(ALL_CHARACTERS.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInteger(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  const password = characters.join("");
  if (password.length < PASSWORD_MIN_LENGTH || password.length > PASSWORD_MAX_LENGTH) {
    throw new Error("Generated temporary password violates the configured password length policy");
  }
  return password;
}

async function assertEveryTargetRoleInManagerScope(client, actor, target, managerRole) {
  if (target.roles.some((role) => !RESETTABLE_ROLES[managerRole].has(role))) throw new AuthorizationError("USER_SCOPE_DENIED");
  const result = await client.query(`SELECT NOT EXISTS(
    SELECT 1 FROM user_roles theirs
    WHERE theirs.user_id=$2 AND NOT EXISTS(
      SELECT 1 FROM user_roles mine JOIN roles mr ON mr.id=mine.role_id
      WHERE mine.user_id=$1 AND mr.code=$3 AND mine.project_id=theirs.project_id
        AND (mine.state_id IS NULL OR mine.state_id=theirs.state_id)
    )
  ) AS fully_scoped`, [actor.id, target.id, managerRole]);
  if (!result.rows[0]?.fully_scoped) throw new AuthorizationError("USER_SCOPE_DENIED");
}

export async function authorizeAssistedPasswordReset(client, actor, target, dependencies = {}) {
  const assertManagementScope = dependencies.assertManagementScope || assertUserInManagementScope;
  const assertDigitalAccess = dependencies.assertDigitalAccess || assertGroupAction;

  if (actor.roles?.includes("SUPER_ADMIN")) return { authorityRole: "SUPER_ADMIN" };

  const managerRole = highestManagementRole(actor);
  if (managerRole) {
    await assertManagementScope(client, actor, target.id);
    await assertEveryTargetRoleInManagerScope(client, actor, target, managerRole);
    return { authorityRole: managerRole };
  }

  if (actor.roles?.includes("FACILITATOR") && target.roles.length > 0 && target.roles.every((role) => role === "VSLA_MEMBER")) {
    const groups = (await client.query(`SELECT gm.group_id FROM group_members gm
      JOIN vsla_groups g ON g.id=gm.group_id AND g.organization_id=gm.organization_id
      WHERE gm.linked_user_id=$1 AND gm.organization_id=$2 AND gm.status='ACTIVE' AND g.status='ACTIVE'`,
    [target.id, actor.organization_id])).rows;
    for (const group of groups) {
      try {
        await assertDigitalAccess(actor, group.group_id, GROUP_ACTION.DIGITAL_ACCESS_MANAGE, client);
        return { authorityRole: "FACILITATOR", groupId: group.group_id };
      } catch (error) {
        if (!(error instanceof AuthorizationError || error instanceof NotFoundError)) throw error;
      }
    }
  }

  throw new AuthorizationError("ASSISTED_PASSWORD_RESET_DENIED");
}

async function loadTargetForReset(client, actor, targetUserId, lock = false) {
  const target = (await client.query(`SELECT u.id,u.organization_id,u.first_name,u.last_name,u.email,u.status,
      COALESCE((SELECT array_agg(DISTINCT r.code) FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=u.id),'{}') roles
    FROM users u WHERE u.id=$1 AND u.organization_id=$2${lock ? " FOR UPDATE" : ""}`, [targetUserId, actor.organization_id])).rows[0];
  if (!target) throw new NotFoundError("User account not found");
  return target;
}

export async function assistedPasswordResetWithClient(client, actor, targetUserId, reason, dependencies = {}) {
  if (actor.id === targetUserId) {
    throw resetError("Use the normal change-password flow for your own account.", "SELF_ASSISTED_RESET_NOT_ALLOWED", 403);
  }

  const target = await loadTargetForReset(client, actor, targetUserId, true);
  const authorize = dependencies.authorize || authorizeAssistedPasswordReset;
  const passwordTools = dependencies.passwordTools || bcrypt;
  const passwordGenerator = dependencies.passwordGenerator || generateTemporaryPassword;
  const revokeSessions = dependencies.revokeSessions || revokeUserSessions;
  const audit = dependencies.audit || writeAudit;
  const scope = await authorize(client, actor, target, dependencies);
  if (target.status !== "ACTIVE") {
    throw resetError("Only an active account can receive an assisted password reset.", "ASSISTED_RESET_TARGET_INELIGIBLE");
  }
  const temporaryPassword = passwordGenerator();
  const passwordHash = await passwordTools.hash(temporaryPassword, BCRYPT_COST);

  const updated = (await client.query(`UPDATE users SET password_hash=$2,must_change_password=true,updated_at=now()
    WHERE id=$1 AND organization_id=$3 AND status='ACTIVE' RETURNING id`,
  [target.id, passwordHash, actor.organization_id])).rows[0];
  if (!updated) throw resetError("The account could not be reset.", "ASSISTED_PASSWORD_RESET_FAILED");

  await revokeSessions(client, target.id);
  await audit(client, {
    organizationId: actor.organization_id,
    actorUserId: actor.id,
    action: "USER_ASSISTED_PASSWORD_RESET",
    entityType: "USER",
    entityId: target.id,
    newValues: { targetUserId: target.id, reason, authorityRole: scope.authorityRole, groupId: scope.groupId || null },
  });

  return {
    target: { id: target.id, displayName: `${target.first_name} ${target.last_name}`.trim(), login: target.email },
    temporaryPassword,
  };
}

export function runAssistedPasswordReset(dbPool, actor, targetUserId, reason, dependencies = {}) {
  return runTransaction(dbPool, (client) => assistedPasswordResetWithClient(client, actor, targetUserId, reason, dependencies));
}

export function assistedPasswordReset(actor, targetUserId, reason) {
  return runAssistedPasswordReset(pool, actor, targetUserId, reason);
}

export async function assistedPasswordResetWithTurnstile(actor, targetUserId, data, dependencies = {}) {
  const verifyChallenge = dependencies.verifyTurnstile || verifyTurnstileToken;
  const reset = dependencies.reset || assistedPasswordReset;
  await verifyChallenge({ token: data.turnstileToken, expectedAction: TURNSTILE_ACTIONS.ASSISTED_PASSWORD_RESET });
  return reset(actor, targetUserId, data.reason);
}

export async function canAssistedPasswordReset(client, actor, targetUserId) {
  if (!targetUserId || actor.id === targetUserId) return false;
  try {
    const target = await loadTargetForReset(client, actor, targetUserId);
    if (target.status !== "ACTIVE") return false;
    await authorizeAssistedPasswordReset(client, actor, target);
    return true;
  } catch (error) {
    if (error instanceof AuthorizationError || error instanceof NotFoundError) return false;
    throw error;
  }
}
