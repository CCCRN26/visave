INSERT INTO permissions(code) SELECT unnest(ARRAY['shareout.view','shareout.prepare','shareout.approve','shareout.payout','shareout.reverse','cycle.close','social_fund.carry_forward']) ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN('SUPER_ADMIN','PROJECT_ADMIN','STATE_COORDINATOR','FACILITATOR') AND p.code IN('shareout.view','shareout.prepare','shareout.approve','shareout.payout','shareout.reverse','cycle.close','social_fund.carry_forward') ON CONFLICT DO NOTHING;
