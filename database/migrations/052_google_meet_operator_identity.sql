ALTER TABLE users
  ADD COLUMN google_meet_email VARCHAR(254),
  ADD CONSTRAINT users_google_meet_email_normalized_check
    CHECK (
      google_meet_email IS NULL
      OR google_meet_email = lower(btrim(google_meet_email))
    );
