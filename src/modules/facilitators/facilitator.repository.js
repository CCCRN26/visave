export async function list(client, actor, filters) {
  const values = [
    actor.organization_id,
    filters.search,
    filters.status || null,
    filters.projectId || null,
    filters.stateId || null,
    filters.lgaId || null,
    actor.id,
    actor.roles,
    filters.pageSize,
    (filters.page - 1) * filters.pageSize,
  ];
  const rows = (
    await client.query(
      `SELECT fp.id,fp.user_id,fp.staff_code,fp.status,fp.state_id,fp.lga_id,u.first_name,u.last_name,u.email,u.phone,u.status account_status,u.created_at,u.updated_at,p.id project_id,p.name project_name,s.name state_name,l.name lga_name,COUNT(DISTINCT g.id)::int assigned_groups,COUNT(*) OVER()::int total
    FROM facilitator_profiles fp JOIN users u ON u.id=fp.user_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code='FACILITATOR' LEFT JOIN projects p ON p.id=ur.project_id LEFT JOIN states s ON s.id=fp.state_id LEFT JOIN lgas l ON l.id=fp.lga_id LEFT JOIN vsla_groups g ON g.facilitator_user_id=u.id AND g.status<>'ARCHIVED'
    WHERE u.organization_id=$1 AND ($2='' OR concat_ws(' ',u.first_name,u.last_name) ILIKE '%'||$2||'%' OR u.email ILIKE '%'||$2||'%' OR fp.staff_code ILIKE '%'||$2||'%') AND ($3::text IS NULL OR fp.status=$3) AND ($4::uuid IS NULL OR ur.project_id=$4) AND ($5::uuid IS NULL OR fp.state_id=$5) AND ($6::uuid IS NULL OR fp.lga_id=$6)
      AND ('SUPER_ADMIN'=ANY($8::text[]) OR EXISTS(SELECT 1 FROM user_roles ar JOIN roles rr ON rr.id=ar.role_id WHERE ar.user_id=$7 AND ar.project_id=ur.project_id AND (ar.state_id IS NULL OR ar.state_id=fp.state_id)))
    GROUP BY fp.id,u.id,p.id,s.name,l.name ORDER BY u.first_name,u.last_name LIMIT $9 OFFSET $10`,
      values,
    )
  ).rows;
  return {
    items: rows,
    total: rows[0]?.total || 0,
    page: filters.page,
    pageSize: filters.pageSize,
  };
}

export async function detail(client, id, organizationId, lock = false) {
  const suffix = lock ? " FOR UPDATE OF fp,u,ur" : "";
  const facilitator = (
    await client.query(
      `SELECT fp.*,u.first_name,u.last_name,u.email,u.phone,u.status account_status,u.created_at user_created_at,u.updated_at user_updated_at,ur.project_id,ur.state_id role_state_id,p.name project_name,s.name state_name,l.name lga_name FROM facilitator_profiles fp JOIN users u ON u.id=fp.user_id JOIN user_roles ur ON ur.user_id=u.id JOIN roles r ON r.id=ur.role_id AND r.code='FACILITATOR' LEFT JOIN projects p ON p.id=ur.project_id LEFT JOIN states s ON s.id=fp.state_id LEFT JOIN lgas l ON l.id=fp.lga_id WHERE fp.id=$1 AND u.organization_id=$2${suffix}`,
      [id, organizationId],
    )
  ).rows[0];
  if (!facilitator) return null;
  const groups = (
    await client.query(
      `SELECT g.id,g.group_code,g.name,g.status,g.operation_mode,g.project_id,g.state_id,g.lga_id,p.name project_name,s.name state_name,l.name lga_name FROM vsla_groups g JOIN projects p ON p.id=g.project_id LEFT JOIN states s ON s.id=g.state_id LEFT JOIN lgas l ON l.id=g.lga_id WHERE g.facilitator_user_id=$1 ORDER BY g.name`,
      [facilitator.user_id],
    )
  ).rows;
  return { facilitator, groups };
}

export async function scope(client, organizationId, projectId, stateId, lgaId) {
  return (
    await client.query(
      `SELECT p.id project_id,p.name project_name,s.id state_id,s.name state_name,l.id lga_id,l.name lga_name FROM projects p JOIN states s ON s.id=$3 LEFT JOIN lgas l ON l.id=$4 WHERE p.id=$2 AND p.organization_id=$1 AND ($4::uuid IS NULL OR l.state_id=s.id)`,
      [organizationId, projectId, stateId, lgaId || null],
    )
  ).rows[0];
}

export async function compatibleGroups(
  client,
  organizationId,
  projectId,
  stateId,
  lgaId,
  groupIds,
) {
  return (
    await client.query(
      `SELECT g.* FROM vsla_groups g WHERE g.organization_id=$1 AND g.project_id=$2 AND g.state_id=$3 AND ($4::uuid IS NULL OR g.lga_id=$4) AND g.status<>'ARCHIVED' AND g.id=ANY($5::uuid[]) FOR UPDATE`,
      [organizationId, projectId, stateId, lgaId || null, groupIds],
    )
  ).rows;
}
