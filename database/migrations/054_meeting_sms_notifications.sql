-- Separate meeting SMS outbox; combines historical 040/041 on the current migration line.
CREATE TABLE IF NOT EXISTS meeting_notifications (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 organization_id UUID NOT NULL REFERENCES organizations(id),
 group_id UUID NOT NULL,
 cycle_id UUID NOT NULL,
 meeting_id UUID NOT NULL,
 member_id UUID NOT NULL,
 notification_type VARCHAR(40) NOT NULL CHECK(notification_type IN ('MEETING_SUMMARY')),
 channel VARCHAR(20) NOT NULL CHECK(channel IN ('SMS')),
 recipient_phone VARCHAR(20),
 payload JSONB NOT NULL,
 status VARCHAR(32) NOT NULL CHECK(status IN ('PENDING','PROCESSING','SUBMITTED','FAILED','SKIPPED_NO_PHONE','SKIPPED_INVALID_PHONE','SKIPPED_TRIAL_LIMIT')),
 provider VARCHAR(20) NOT NULL CHECK(provider IN ('TWILIO')),
 provider_recipient_phone VARCHAR(20),
 provider_message_sid VARCHAR(80),
 provider_error_code VARCHAR(64),
 provider_error_message VARCHAR(500),
 attempt_count INTEGER NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 submitted_at TIMESTAMPTZ,
 updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,cycle_id) REFERENCES vsla_cycles(group_id,id),
 FOREIGN KEY(group_id,meeting_id) REFERENCES vsla_meetings(group_id,id),
 FOREIGN KEY(cycle_id,meeting_id) REFERENCES vsla_meetings(cycle_id,id),
 FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id),
 FOREIGN KEY(organization_id,cycle_id) REFERENCES vsla_cycles(organization_id,id),
 FOREIGN KEY(organization_id,member_id) REFERENCES group_members(organization_id,id),
 UNIQUE(meeting_id,member_id,notification_type)
);
CREATE INDEX IF NOT EXISTS meeting_notifications_meeting_status_idx ON meeting_notifications(meeting_id,status,created_at);
CREATE INDEX IF NOT EXISTS meeting_notifications_status_created_idx ON meeting_notifications(status,created_at);
