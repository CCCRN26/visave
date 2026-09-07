-- Seed roles are normally installed after migrations. Create the Agent role here so
-- permission grants from the completed migration set can be applied on fresh installs.
INSERT INTO roles(code,name,description)
VALUES ('FACILITATOR','Facilitator','Assigned Agent responsible for scoped VSLA onboarding and support')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code='FACILITATOR'
  AND p.code IN (
    'project.view',
    'group.create','group.view','group.update','group.activate','group_public.manage',
    'member.create','member.view','member.update','member_access.view','member_access.manage',
    'constitution.view','constitution.manage','constitution.approve',
    'cycle.view','cycle.manage','cycle.close',
    'officer.view','officer.manage',
    'meeting.create','meeting.view','meeting.manage',
    'savings.view','savings.record',
    'social_fund.view','social_fund.record','social_fund.carry_forward',
    'fine.view','fine.record','financial.reverse',
    'loan.view','loan.request','loan.approve','loan.disburse','loan.repay','loan.default','loan.reverse',
    'shareout.view','shareout.prepare','shareout.approve','shareout.payout','shareout.reverse',
    'group_operation_mode.view',
    'join_request.view','join_request.manage','join_request.convert',
    'notification.view'
  )
ON CONFLICT DO NOTHING;
