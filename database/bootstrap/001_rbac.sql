INSERT INTO roles(code,name) VALUES
 ('SUPER_ADMIN','Super Admin'),('PROJECT_ADMIN','Project Admin'),('STATE_COORDINATOR','State Coordinator'),
 ('FACILITATOR','Facilitator'),('GROUP_OFFICER','Group Officer'),('MEMBER','Member'),('VSLA_MEMBER','VSLA Member')
ON CONFLICT(code) DO NOTHING;

INSERT INTO permissions(code) SELECT unnest(ARRAY[
 'organization.view','organization.manage','project.create','project.view','project.update','project.archive',
 'user.create','user.view','user.update','user.disable','facilitator.create','facilitator.view','facilitator.update',
 'group.create','group.view','group.update','group.activate','group.archive','member.create','member.view','member.update',
 'constitution.view','constitution.manage','constitution.approve','cycle.view','cycle.manage','cycle.close',
 'officer.view','officer.manage','meeting.create','meeting.view','meeting.manage','savings.view','savings.record',
 'social_fund.view','social_fund.record','social_fund.approve','social_fund.carry_forward','fine.view','fine.record','financial.reverse',
 'loan.view','loan.request','loan.approve','loan.disburse','loan.repay','loan.default','loan.reverse',
 'shareout.view','shareout.prepare','shareout.approve','shareout.payout','shareout.reverse','shareout.execute',
 'report.view','report.export','audit.view','group_public.manage','join_request.view','join_request.manage','join_request.convert','notification.view'
]) ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='SUPER_ADMIN' ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code IN ('PROJECT_ADMIN','STATE_COORDINATOR')
 AND p.code IN ('project.view','project.update','user.create','user.view','user.update','user.disable','facilitator.create','facilitator.view','facilitator.update',
 'group.create','group.view','group.update','group.activate','group.archive','member.create','member.view','member.update',
 'constitution.view','constitution.manage','constitution.approve','cycle.view','cycle.manage','cycle.close','officer.view','officer.manage',
 'meeting.create','meeting.view','meeting.manage','savings.view','savings.record','social_fund.view','social_fund.record','social_fund.carry_forward',
 'fine.view','fine.record','financial.reverse','loan.view','loan.request','loan.approve','loan.disburse','loan.repay','loan.default','loan.reverse',
 'shareout.view','shareout.prepare','shareout.approve','shareout.payout','shareout.reverse','report.view','report.export',
 'group_public.manage','join_request.view','join_request.manage','join_request.convert','notification.view') ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='FACILITATOR'
 AND p.code IN ('project.view','group.create','group.view','group.update','group.activate','member.create','member.view','member.update',
 'constitution.view','constitution.manage','cycle.view','cycle.manage','cycle.close','officer.view','officer.manage','meeting.create','meeting.view','meeting.manage',
 'savings.view','savings.record','social_fund.view','social_fund.record','social_fund.carry_forward','fine.view','fine.record','financial.reverse',
 'loan.view','loan.request','loan.approve','loan.disburse','loan.repay','loan.default','loan.reverse','shareout.view','shareout.prepare','shareout.approve',
 'shareout.payout','shareout.reverse','group_public.manage','join_request.view','join_request.manage','join_request.convert','notification.view') ON CONFLICT DO NOTHING;

-- These permissions only admit a VSLA member to the action-aware group policy.
-- Runtime membership, cycle, current assignment, position and operation-mode checks remain mandatory.
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p WHERE r.code='VSLA_MEMBER'
 AND p.code IN ('group.view','member.view','officer.view','constitution.view','constitution.manage','cycle.view','cycle.manage','cycle.close',
 'meeting.create','meeting.view','meeting.manage','savings.view','savings.record','social_fund.view','social_fund.record','fine.view','fine.record',
 'financial.reverse','loan.view','loan.request','loan.approve','loan.disburse','loan.repay','loan.default','loan.reverse','shareout.view') ON CONFLICT DO NOTHING;
