import { withTransaction } from "@/lib/db/transaction";
import { writeAudit } from "@/lib/audit/audit.service";
import { AppError, AuthorizationError } from "@/lib/errors";
import { validateLocationHierarchy } from "@/modules/locations/location.service";
import { findGroup, updateGroup } from "./group.repository.js";

const denied = () => new AppError("Agent group scope denied", "AGENT_GROUP_SCOPE_DENIED", 403);

export async function createScopedGroup(data, user) {
  return withTransaction(async (client) => {
    const agent = user.roles.includes("FACILITATOR");
    let profile = null;
    if (agent) {
      profile = (await client.query(`SELECT fp.*,ur.project_id FROM facilitator_profiles fp JOIN users u ON u.id=fp.user_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code='FACILITATOR' WHERE fp.user_id=$1 AND fp.status='ACTIVE' AND u.status='ACTIVE' AND ur.project_id=$2 AND (ur.state_id IS NULL OR ur.state_id=$3) AND (fp.state_id IS NULL OR fp.state_id=$3) AND (fp.lga_id IS NULL OR fp.lga_id=$4)`, [user.id,data.projectId,data.stateId,data.lgaId||null])).rows[0];
      if (!profile) throw denied();
    } else if (!user.roles.some((role) => ["SUPER_ADMIN","PROJECT_ADMIN","STATE_COORDINATOR"].includes(role))) throw new AuthorizationError();
    const project = (await client.query("SELECT id FROM projects WHERE id=$2 AND organization_id=$1", [user.organization_id,data.projectId])).rows[0];
    if (!project) throw new AppError("Invalid project", "INVALID_PROJECT", 400);
    await validateLocationHierarchy(client, data);
    if (!agent && !user.roles.includes("SUPER_ADMIN")) {
      const allowed = (await client.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id WHERE ur.user_id=$1 AND ur.project_id=$2 AND (ur.state_id IS NULL OR ur.state_id=$3) AND r.code IN('PROJECT_ADMIN','STATE_COORDINATOR')`, [user.id,data.projectId,data.stateId])).rowCount;
      if (!allowed) throw new AuthorizationError();
    }
    const code = (await client.query(`SELECT o.code||'-'||COALESCE(s.code,'GRP')||'-'||lpad((COUNT(g.id)+1)::text,4,'0') code FROM organizations o JOIN states s ON s.id=$2 LEFT JOIN vsla_groups g ON g.organization_id=o.id AND g.state_id=s.id WHERE o.id=$1 GROUP BY o.code,s.code`, [user.organization_id,data.stateId])).rows[0].code;
    const assigned = agent ? user.id : data.facilitatorUserId || null;
    const group = (await client.query(`INSERT INTO vsla_groups(organization_id,project_id,group_code,name,state_id,lga_id,community_id,community_name,facilitator_user_id,created_by_facilitator_id,date_formed,meeting_location,expected_member_count,onboarding_notes,group_type,status,operation_mode,public_visibility,membership_intake_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'PROGRAM_ASSISTED','HIDDEN','CLOSED',$17) RETURNING *`, [user.organization_id,data.projectId,code,data.name,data.stateId,data.lgaId,data.communityId||null,data.communityName||null,assigned,profile?.id||null,data.dateFormed||null,data.meetingLocation||null,data.expectedMemberCount||null,data.notes||null,data.groupType,agent?"ONBOARDING":data.status,user.id])).rows[0];
    await writeAudit(client, { organizationId:user.organization_id,actorUserId:user.id,action:agent?"GROUP_CREATED_BY_AGENT":"GROUP_CREATED",entityType:"VSLA_GROUP",entityId:group.id,newValues:{groupId:group.id,agentUserId:agent?user.id:null,facilitatorProfileId:profile?.id||null,projectId:group.project_id,stateId:group.state_id,lgaId:group.lga_id} });
    return group;
  });
}

export async function updateScopedGroup(id, data, user) {
  return withTransaction(async (client) => {
    const current = await findGroup(client, id, user.organization_id);
    if (!current) return null;
    if (Object.hasOwn(data, "communityName") && !Object.hasOwn(data, "communityId")) data.communityId = null;
    if (!Object.hasOwn(data, "communityId") && ((Object.hasOwn(data, "stateId") && data.stateId !== current.state_id) || (Object.hasOwn(data, "lgaId") && data.lgaId !== current.lga_id))) data.communityId = null;
    const finalLocation = {
      stateId: Object.hasOwn(data, "stateId") ? data.stateId : current.state_id,
      lgaId: Object.hasOwn(data, "lgaId") ? data.lgaId : current.lga_id,
      communityId: Object.hasOwn(data, "communityId") ? data.communityId : current.community_id,
    };
    await validateLocationHierarchy(client, finalLocation);
    if (user.roles.includes("FACILITATOR") && !user.roles.some((role) => ["SUPER_ADMIN","PROJECT_ADMIN","STATE_COORDINATOR"].includes(role))) {
      const projectId = Object.hasOwn(data, "projectId") ? data.projectId : current.project_id;
      const scoped = (await client.query(`SELECT 1 FROM facilitator_profiles fp JOIN user_roles ur ON ur.user_id=fp.user_id JOIN roles r ON r.id=ur.role_id AND r.code='FACILITATOR' WHERE fp.user_id=$1 AND fp.status='ACTIVE' AND ur.project_id=$2 AND (ur.state_id IS NULL OR ur.state_id=$3) AND (fp.state_id IS NULL OR fp.state_id=$3) AND (fp.lga_id IS NULL OR fp.lga_id=$4)`,[user.id,projectId,finalLocation.stateId,finalLocation.lgaId])).rowCount;
      if (!scoped) throw denied();
    }
    const value = await updateGroup(client, id, data, user.organization_id);
    await writeAudit(client, { organizationId:user.organization_id,actorUserId:user.id,action:"GROUP_UPDATED",entityType:"VSLA_GROUP",entityId:id,oldValues:current,newValues:value });
    return value;
  });
}
