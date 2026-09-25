ALTER TABLE vsla_meetings
  ADD COLUMN meeting_mode VARCHAR(8) NOT NULL DEFAULT 'PHYSICAL',
  ADD COLUMN virtual_meeting_url TEXT,
  ADD CONSTRAINT vsla_meetings_meeting_mode_check
    CHECK (meeting_mode IN ('PHYSICAL', 'VIRTUAL', 'HYBRID')),
  ADD CONSTRAINT vsla_meetings_virtual_meeting_check
    CHECK (
      (meeting_mode = 'PHYSICAL' AND virtual_meeting_url IS NULL)
      OR
      (meeting_mode IN ('VIRTUAL', 'HYBRID') AND virtual_meeting_url IS NOT NULL)
    );
