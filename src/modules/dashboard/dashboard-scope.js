const PROGRAM_ROLES = ["SUPER_ADMIN", "PROJECT_ADMIN", "STATE_COORDINATOR"];

export async function resolveDashboardScope(user, client) {
  if (user.roles?.some((role) => PROGRAM_ROLES.includes(role))) {
    return { scopeType: "ORGANIZATION", groupId: null };
  }
  if (user.roles?.includes("FACILITATOR")) {
    return { scopeType: "FACILITATOR", groupId: null };
  }
  const rows = (await client.query(
    `SELECT g.id group_id
       FROM group_members gm
       JOIN vsla_groups g ON g.id=gm.group_id
       JOIN vsla_cycles cy ON cy.group_id=g.id AND cy.status='ACTIVE'
       JOIN group_officer_assignments oa ON oa.group_id=g.id AND oa.cycle_id=cy.id
         AND oa.member_id=gm.id AND oa.status='ACTIVE'
      WHERE gm.linked_user_id=$1 AND gm.organization_id=$2 AND gm.status='ACTIVE'
        AND g.organization_id=$2 AND g.status<>'ARCHIVED'
      ORDER BY g.id`,
    [user.id, user.organization_id],
  )).rows;
  if (!rows.length) return { scopeType: "NO_ACTIVE_GROUP", groupId: null };
  return { scopeType: "GROUPS", groupId: null, groupIds: [...new Set(rows.map((row) => row.group_id))] };
}

export function dashboardScopeSql(parameterOffset = 1) {
  const organization = `$${parameterOffset}`;
  const userId = `$${parameterOffset + 1}`;
  const roles = `$${parameterOffset + 2}`;
  const scopeType = `$${parameterOffset + 3}`;
  const groupId = `$${parameterOffset + 4}`;
  return `g.organization_id=${organization} AND g.status<>'ARCHIVED' AND (
    (${scopeType}='ORGANIZATION' AND (
      'SUPER_ADMIN'=ANY(${roles}::text[]) OR EXISTS(
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=${userId} AND r.code IN ('PROJECT_ADMIN','STATE_COORDINATOR')
          AND ur.project_id=g.project_id AND (ur.state_id IS NULL OR ur.state_id=g.state_id)
      )
    )) OR (${scopeType}='FACILITATOR' AND g.facilitator_user_id=${userId})
      OR (${scopeType}='GROUPS' AND g.id=ANY(${groupId}::uuid[]))
  )`;
}
