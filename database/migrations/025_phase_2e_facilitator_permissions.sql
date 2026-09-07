INSERT INTO permissions(code,description) VALUES
 ('facilitator.view','View facilitator profiles and assignments'),
 ('facilitator.create','Create facilitator accounts and profiles'),
 ('facilitator.update','Update facilitator details and scope'),
 ('facilitator.activate','Activate facilitator accounts'),
 ('facilitator.deactivate','Deactivate facilitator accounts'),
 ('facilitator.assign_groups','Assign and reassign groups to facilitators')
ON CONFLICT(code) DO UPDATE SET description=EXCLUDED.description;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='SUPER_ADMIN' AND p.code LIKE 'facilitator.%'
ON CONFLICT DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN('PROJECT_ADMIN','STATE_COORDINATOR')
  AND p.code IN('facilitator.view','facilitator.create','facilitator.update','facilitator.activate','facilitator.deactivate','facilitator.assign_groups')
ON CONFLICT DO NOTHING;

