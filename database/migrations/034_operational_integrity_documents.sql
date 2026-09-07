CREATE OR REPLACE FUNCTION enforce_one_active_savings_purchase() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaction_kind <> 'PURCHASE' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.meeting_id::text || ':' || NEW.member_id::text || ':SAVINGS', 0));
  IF EXISTS (
    SELECT 1 FROM savings_transactions s
    JOIN financial_transactions original ON original.id=s.financial_transaction_id
    WHERE s.meeting_id=NEW.meeting_id AND s.member_id=NEW.member_id AND s.transaction_kind='PURCHASE'
      AND NOT EXISTS (SELECT 1 FROM financial_transactions reversal WHERE reversal.reversal_of_transaction_id=original.id)
  ) THEN
    RAISE EXCEPTION 'active savings purchase already exists for this member and meeting'
      USING ERRCODE='23505', CONSTRAINT='one_active_savings_purchase_per_member_meeting';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER one_active_savings_purchase_per_member_meeting
BEFORE INSERT ON savings_transactions FOR EACH ROW EXECUTE FUNCTION enforce_one_active_savings_purchase();

CREATE TABLE reconciliation_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id),
  group_id UUID NOT NULL REFERENCES vsla_groups(id), meeting_id UUID NOT NULL REFERENCES vsla_meetings(id),
  reconciliation_id UUID NOT NULL UNIQUE REFERENCES meeting_reconciliations(id), signed_by_user_id UUID NOT NULL REFERENCES users(id),
  signed_at TIMESTAMPTZ NOT NULL DEFAULT now(), storage_key VARCHAR(500) NOT NULL UNIQUE,
  mime_type VARCHAR(80) NOT NULL CHECK(mime_type='image/png'), file_size_bytes INTEGER NOT NULL CHECK(file_size_bytes BETWEEN 1 AND 1048576),
  sha256 CHAR(64) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX reconciliation_signatures_meeting_idx ON reconciliation_signatures(meeting_id);

CREATE TABLE constitution_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id),
  group_id UUID NOT NULL REFERENCES vsla_groups(id), constitution_id UUID NOT NULL REFERENCES group_constitutions(id),
  original_filename VARCHAR(255) NOT NULL, storage_key VARCHAR(500) NOT NULL UNIQUE,
  mime_type VARCHAR(80) NOT NULL CHECK(mime_type='application/pdf'), file_size_bytes INTEGER NOT NULL CHECK(file_size_bytes BETWEEN 1 AND 10485760),
  sha256 CHAR(64) NOT NULL, uploaded_by_user_id UUID NOT NULL REFERENCES users(id), uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  replaced_by_document_id UUID REFERENCES constitution_documents(id), archived_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX one_current_constitution_document ON constitution_documents(constitution_id) WHERE archived_at IS NULL;
CREATE INDEX constitution_documents_group_idx ON constitution_documents(group_id,constitution_id);

INSERT INTO permissions(code,description) VALUES ('group.archive','Archive a group while preserving its history') ON CONFLICT(code) DO NOTHING;
INSERT INTO role_permissions(role_id,permission_id)
SELECT r.id,p.id FROM roles r CROSS JOIN permissions p
WHERE r.code IN('SUPER_ADMIN','PROJECT_ADMIN','STATE_COORDINATOR') AND p.code='group.archive'
ON CONFLICT DO NOTHING;
