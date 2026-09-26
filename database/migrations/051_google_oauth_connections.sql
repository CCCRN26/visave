CREATE TABLE organization_google_oauth_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  provider VARCHAR(20) NOT NULL DEFAULT 'GOOGLE' CHECK (provider = 'GOOGLE'),
  connected_email VARCHAR(254) NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv VARCHAR(64) NOT NULL,
  token_auth_tag VARCHAR(64) NOT NULL,
  encryption_key_version SMALLINT NOT NULL DEFAULT 1 CHECK (encryption_key_version > 0),
  scopes TEXT[] NOT NULL,
  connected_by UUID NOT NULL REFERENCES users(id),
  connected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE UNIQUE INDEX one_active_google_connection_per_organization
  ON organization_google_oauth_connections(organization_id)
  WHERE revoked_at IS NULL;

CREATE INDEX google_connections_organization_history_idx
  ON organization_google_oauth_connections(organization_id, connected_at DESC);

ALTER TABLE vsla_meetings
  DROP CONSTRAINT vsla_meetings_virtual_meeting_check,
  ADD COLUMN google_meet_space_name VARCHAR(255),
  ADD CONSTRAINT vsla_meetings_virtual_meeting_check
    CHECK (
      (
        meeting_mode = 'PHYSICAL'
        AND virtual_meeting_url IS NULL
        AND google_meet_space_name IS NULL
      )
      OR
      (
        meeting_mode IN ('VIRTUAL', 'HYBRID')
        AND (google_meet_space_name IS NULL OR virtual_meeting_url IS NOT NULL)
      )
    ),
  ADD CONSTRAINT vsla_meetings_google_space_name_check
    CHECK (
      google_meet_space_name IS NULL
      OR google_meet_space_name ~ '^spaces/[^/[:space:]]+$'
    );

CREATE UNIQUE INDEX vsla_meetings_google_space_name_unique
  ON vsla_meetings(google_meet_space_name)
  WHERE google_meet_space_name IS NOT NULL;
