import { AuthorizationError, NotFoundError } from "../../lib/errors/index.js";

export const ASSIGNABLE_ROLE_CODES = new Set(["SUPER_ADMIN", "PROJECT_ADMIN", "STATE_COORDINATOR", "FACILITATOR", "VSLA_MEMBER"]);
const ROLE_CEILING = {
  SUPER_ADMIN: ASSIGNABLE_ROLE_CODES,
  PROJECT_ADMIN: new Set(["PROJECT_ADMIN", "STATE_COORDINATOR", "FACILITATOR", "VSLA_MEMBER"]),
  STATE_COORDINATOR: new Set(["STATE_COORDINATOR", "FACILITATOR", "VSLA_MEMBER"]),
};

export function highestManagementRole(user) {
  return ["SUPER_ADMIN", "PROJECT_ADMIN", "STATE_COORDINATOR"].find((role) => user.roles?.includes(role));
}

export async function assertRoleAssignment(client, actor, { roleCode, projectId, stateId }) {
  const managerRole = highestManagementRole(actor);
  if (!managerRole || !roleCode || !ROLE_CEILING[managerRole].has(roleCode)) throw new AuthorizationError("ROLE_ASSIGNMENT_DENIED");
  if (managerRole === "SUPER_ADMIN") return;
  if (!projectId) throw new AuthorizationError("PROJECT_SCOPE_REQUIRED");
  const scoped = (await client.query(`SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
    WHERE ur.user_id=$1 AND r.code=$2 AND ur.project_id=$3 AND ($4::uuid IS NULL OR ur.state_id IS NULL OR ur.state_id=$4)`,
  [actor.id, managerRole, projectId, stateId || null])).rowCount > 0;
  if (!scoped || (managerRole === "STATE_COORDINATOR" && !stateId)) throw new AuthorizationError("USER_SCOPE_DENIED");
}

export async function assertUserInManagementScope(client, actor, targetUserId) {
  const target = (await client.query("SELECT id FROM users WHERE id=$1 AND organization_id=$2", [targetUserId, actor.organization_id])).rows[0];
  if (!target) throw new NotFoundError();
  if (actor.roles?.includes("SUPER_ADMIN")) return target;
  const managerRole = highestManagementRole(actor);
  if (!managerRole) throw new AuthorizationError("USER_SCOPE_DENIED");
  const scoped = (await client.query(`SELECT 1 FROM user_roles mine JOIN roles mr ON mr.id=mine.role_id
    JOIN user_roles theirs ON theirs.user_id=$2 AND theirs.project_id=mine.project_id JOIN roles tr ON tr.id=theirs.role_id
    WHERE mine.user_id=$1 AND mr.code=$3 AND (mine.state_id IS NULL OR mine.state_id=theirs.state_id) AND tr.code<>'SUPER_ADMIN'`,
  [actor.id, targetUserId, managerRole])).rowCount > 0;
  if (!scoped) throw new AuthorizationError("USER_SCOPE_DENIED");
  return target;
}

export function userScopePredicate(user, startIndex = 1) {
  if (user.roles?.includes("SUPER_ADMIN")) return { sql: "TRUE", params: [] };
  const role = highestManagementRole(user);
  if (!role) return { sql: "FALSE", params: [] };
  return { sql: `EXISTS (SELECT 1 FROM user_roles mine JOIN roles mr ON mr.id=mine.role_id
    JOIN user_roles theirs ON theirs.user_id=u.id AND theirs.project_id=mine.project_id JOIN roles tr ON tr.id=theirs.role_id
    WHERE mine.user_id=$${startIndex} AND mr.code=$${startIndex + 1} AND (mine.state_id IS NULL OR mine.state_id=theirs.state_id)
    AND tr.code<>'SUPER_ADMIN')`, params: [user.id, role] };
}
