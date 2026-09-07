INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='FACILITATOR' AND p.code='group.activate'
ON CONFLICT DO NOTHING;
