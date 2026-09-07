CREATE OR REPLACE FUNCTION enforce_one_active_social_contribution() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaction_kind <> 'CONTRIBUTION' THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.meeting_id::text || ':' || NEW.member_id::text, 0));
  IF EXISTS (
    SELECT 1
    FROM social_fund_transactions s
    JOIN financial_transactions original ON original.id=s.financial_transaction_id
    WHERE s.meeting_id=NEW.meeting_id
      AND s.member_id=NEW.member_id
      AND s.transaction_kind='CONTRIBUTION'
      AND NOT EXISTS (
        SELECT 1 FROM financial_transactions reversal
        WHERE reversal.reversal_of_transaction_id=original.id
      )
  ) THEN
    RAISE EXCEPTION 'active social fund contribution already exists for this member and meeting'
      USING ERRCODE='23505', CONSTRAINT='one_active_social_contribution_per_member_meeting';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER one_active_social_contribution_per_member_meeting
BEFORE INSERT ON social_fund_transactions
FOR EACH ROW EXECUTE FUNCTION enforce_one_active_social_contribution();
