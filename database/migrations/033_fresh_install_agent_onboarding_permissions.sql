-- These foundation permission rows historically arrived in the post-migration seed.
-- Ensure they exist before the final fresh-install Agent grant is evaluated.
INSERT INTO permissions(code,description) VALUES
  ('group.create','Create a scoped VSLA group'),
  ('group.activate','Activate a ready scoped VSLA group')
ON CONFLICT(code) DO NOTHING;

INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id
FROM roles r
CROSS JOIN permissions p
WHERE r.code='FACILITATOR'
  AND p.code IN ('group.create','group.activate')
ON CONFLICT DO NOTHING;
