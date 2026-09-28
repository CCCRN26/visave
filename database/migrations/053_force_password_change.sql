ALTER TABLE users
  ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT false;

-- This one-time backfill deliberately preserves every pre-existing account's
-- current login experience. Creation flows opt new temporary-password users in.
UPDATE users SET must_change_password = false;

ALTER TABLE users ALTER COLUMN must_change_password SET DEFAULT false;
ALTER TABLE users ALTER COLUMN must_change_password SET NOT NULL;
