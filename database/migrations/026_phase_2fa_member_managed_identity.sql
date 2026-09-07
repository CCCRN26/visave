ALTER TABLE vsla_groups
  ADD COLUMN operation_mode VARCHAR(24) NOT NULL DEFAULT 'PROGRAM_ASSISTED'
  CHECK (operation_mode IN ('PROGRAM_ASSISTED','MEMBER_MANAGED'));

CREATE INDEX groups_operation_mode_idx ON vsla_groups(operation_mode);
CREATE INDEX group_members_group_linked_user_idx ON group_members(group_id,linked_user_id)
  WHERE linked_user_id IS NOT NULL;

INSERT INTO roles(code,name,description) VALUES
  ('VSLA_MEMBER','VSLA Member','Base digital identity for a linked VSLA member; group authority is derived dynamically')
ON CONFLICT(code) DO NOTHING;

INSERT INTO permissions(code,description) VALUES
  ('member_access.view','View member digital-access state'),
  ('member_access.manage','Enable, link, or disable member digital access'),
  ('group_operation_mode.view','View group operating mode and readiness'),
  ('group_operation_mode.manage','Change a group operating mode')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN ('SUPER_ADMIN','PROJECT_ADMIN','STATE_COORDINATOR')
  AND p.code IN ('member_access.view','member_access.manage','group_operation_mode.view','group_operation_mode.manage')
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='FACILITATOR' AND p.code IN ('member_access.view','member_access.manage','group_operation_mode.view')
ON CONFLICT DO NOTHING;

-- These permissions only admit a digital member to the corresponding route.
-- The target-group/current-cycle officer guard remains authoritative.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='VSLA_MEMBER' AND p.code IN (
  'group.view','member.view','cycle.view','constitution.view','officer.view',
  'meeting.view','meeting.manage','savings.view','savings.record',
  'social_fund.view','social_fund.record','fine.view','fine.record',
  'loan.view','loan.request','loan.approve','loan.disburse','loan.repay','loan.reverse',
  'financial.reverse','shareout.view','group_operation_mode.view','member_access.view'
)
ON CONFLICT DO NOTHING;
