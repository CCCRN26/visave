export const DIGITAL_OFFICER_POSITIONS = new Set(['CHAIRPERSON','RECORD_KEEPER']);

export function isCurrentDigitalOfficer(ctx) {
  return Boolean(
    ctx.linked_member_id&&
    ctx.member_status==='ACTIVE'&&
    ctx.active_cycle_id&&ctx.cycle_membership_id!==null&&
    ['ACTIVE','CLOSING','CLOSED'].includes(ctx.cycle_status)&&
    DIGITAL_OFFICER_POSITIONS.has(ctx.officer_position)
  );
}

export async function actorContext(client, user, groupId, lock = false) {
  return (await client.query(`
    SELECT g.id AS group_id,g.organization_id,g.project_id,g.state_id,g.lga_id,g.status AS group_status,
      g.operation_mode,g.facilitator_user_id,
      m.id AS linked_member_id,m.status AS member_status,
      cy.id AS active_cycle_id,cy.status AS cycle_status,cm.id AS cycle_membership_id,
      oa.position_code AS officer_position,
      (g.facilitator_user_id=$2) AS is_assigned_facilitator,
      EXISTS(
        SELECT 1 FROM facilitator_profiles fp JOIN users fu ON fu.id=fp.user_id
        WHERE fp.user_id=$2 AND fp.status='ACTIVE' AND fu.status='ACTIVE'
      ) AS is_active_facilitator,
      EXISTS(
        SELECT 1 FROM user_roles fur JOIN roles fr ON fr.id=fur.role_id AND fr.code='FACILITATOR'
        JOIN facilitator_profiles fp ON fp.user_id=fur.user_id
        WHERE fur.user_id=$2 AND fur.project_id=g.project_id
          AND (fur.state_id IS NULL OR fur.state_id=g.state_id)
          AND (fp.state_id IS NULL OR fp.state_id=g.state_id)
          AND (fp.lga_id IS NULL OR fp.lga_id=g.lga_id)
      ) AS has_facilitator_scope,
      EXISTS(
        SELECT 1 FROM user_roles ur JOIN roles r ON r.id=ur.role_id
        WHERE ur.user_id=$2 AND (r.code='SUPER_ADMIN' OR
          (r.code='PROJECT_ADMIN' AND ur.project_id=g.project_id) OR
          (r.code='STATE_COORDINATOR' AND ur.project_id=g.project_id AND ur.state_id=g.state_id))
      ) AS has_program_scope
    FROM vsla_groups g
    LEFT JOIN group_members m ON m.group_id=g.id AND m.linked_user_id=$2
    LEFT JOIN LATERAL(
      SELECT x.* FROM vsla_cycles x WHERE x.group_id=g.id AND x.status IN('ACTIVE','CLOSING','CLOSED')
      ORDER BY CASE x.status WHEN 'ACTIVE' THEN 1 WHEN 'CLOSING' THEN 2 ELSE 3 END,x.cycle_number DESC LIMIT 1
    ) cy ON true
    LEFT JOIN group_officer_assignments oa ON oa.group_id=g.id AND oa.cycle_id=cy.id
      AND oa.member_id=m.id AND oa.status='ACTIVE'
    LEFT JOIN cycle_memberships cm ON cm.group_id=g.id AND cm.cycle_id=cy.id AND cm.member_id=m.id
    WHERE g.id=$1 AND g.organization_id=$3
    ${lock ? 'FOR UPDATE OF g' : ''}
  `,[groupId,user.id,user.organization_id])).rows[0];
}

export async function linkedGroups(client, user) {
  return (await client.query(`
    SELECT g.id,g.group_code,g.name,g.status,g.operation_mode,m.id member_id,m.member_code,
      m.status member_status,cy.id active_cycle_id,cy.cycle_number,cm.id cycle_membership_id,(cm.id IS NOT NULL) current_participant,oa.position_code officer_position,
      (oa.position_code IN ('CHAIRPERSON','RECORD_KEEPER')) has_officer_workspace
    FROM group_members m JOIN vsla_groups g ON g.id=m.group_id
    LEFT JOIN LATERAL(
      SELECT x.* FROM vsla_cycles x WHERE x.group_id=g.id AND x.status IN('ACTIVE','CLOSING','CLOSED')
      ORDER BY CASE x.status WHEN 'ACTIVE' THEN 1 WHEN 'CLOSING' THEN 2 ELSE 3 END,x.cycle_number DESC LIMIT 1
    ) cy ON true
    LEFT JOIN group_officer_assignments oa ON oa.cycle_id=cy.id AND oa.member_id=m.id AND oa.status='ACTIVE'
    LEFT JOIN cycle_memberships cm ON cm.cycle_id=cy.id AND cm.member_id=m.id
    WHERE m.linked_user_id=$1 AND m.organization_id=$2 AND g.organization_id=$2
      AND m.status='ACTIVE' AND g.status<>'ARCHIVED' AND cy.id IS NOT NULL
    ORDER BY g.name,m.member_code
  `,[user.id,user.organization_id])).rows;
}
