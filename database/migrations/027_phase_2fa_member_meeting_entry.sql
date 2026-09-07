INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code='VSLA_MEMBER' AND p.code='meeting.create'
ON CONFLICT DO NOTHING;
