ALTER TABLE ledger_accounts DROP CONSTRAINT ledger_accounts_account_category_check;
ALTER TABLE ledger_accounts ADD CONSTRAINT ledger_accounts_account_category_check CHECK (account_category IN ('ASSET','LIABILITY','EQUITY','INCOME'));

ALTER TABLE financial_transactions DROP CONSTRAINT financial_transactions_transaction_type_check;
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_transaction_type_check CHECK (transaction_type IN (
  'SAVINGS_PURCHASE','SAVINGS_REVERSAL','SOCIAL_FUND_CONTRIBUTION','SOCIAL_FUND_REVERSAL','FINE','FINE_REVERSAL',
  'LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL','LOAN_REPAYMENT','LOAN_REPAYMENT_REVERSAL',
  'SHAREOUT_RECLASSIFICATION','SHAREOUT_PAYOUT','SHAREOUT_PAYOUT_REVERSAL',
  'SOCIAL_FUND_CARRY_FORWARD_OUT','SOCIAL_FUND_CARRY_FORWARD_IN'
));
ALTER TABLE financial_transactions ALTER COLUMN meeting_id DROP NOT NULL;
ALTER TABLE financial_transactions DROP CONSTRAINT financial_transactions_group_id_meeting_id_fkey;
ALTER TABLE financial_transactions DROP CONSTRAINT financial_transactions_cycle_id_meeting_id_fkey;
ALTER TABLE financial_transactions ADD FOREIGN KEY(group_id,meeting_id) REFERENCES vsla_meetings(group_id,id);
ALTER TABLE financial_transactions ADD FOREIGN KEY(cycle_id,meeting_id) REFERENCES vsla_meetings(cycle_id,id);
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_meeting_scope_check CHECK (
  (meeting_id IS NOT NULL AND transaction_type NOT IN ('SOCIAL_FUND_CARRY_FORWARD_OUT','SOCIAL_FUND_CARRY_FORWARD_IN')) OR
  (meeting_id IS NULL AND transaction_type IN ('SOCIAL_FUND_CARRY_FORWARD_OUT','SOCIAL_FUND_CARRY_FORWARD_IN'))
);

ALTER TABLE vsla_cycles ADD COLUMN closed_by UUID REFERENCES users(id);

CREATE TABLE cycle_shareouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, final_meeting_id UUID NOT NULL,
  version_number INTEGER NOT NULL CHECK(version_number>0), status VARCHAR(24) NOT NULL CHECK(status IN ('DRAFT','APPROVED','PAYOUT_IN_PROGRESS','COMPLETED','CANCELLED')),
  total_net_shares BIGINT NOT NULL CHECK(total_net_shares>0), total_net_savings NUMERIC(18,2) NOT NULL CHECK(total_net_savings>=0), fine_income NUMERIC(18,2) NOT NULL CHECK(fine_income>=0), service_charge_income NUMERIC(18,2) NOT NULL CHECK(service_charge_income>=0), distributable_fund NUMERIC(18,2) NOT NULL CHECK(distributable_fund>0), raw_value_per_share NUMERIC(24,8) NOT NULL CHECK(raw_value_per_share>0), social_fund_balance_snapshot NUMERIC(18,2) NOT NULL CHECK(social_fund_balance_snapshot>=0),
  financial_state_fingerprint VARCHAR(128) NOT NULL, algorithm_version VARCHAR(40) NOT NULL DEFAULT 'LARGEST_REMAINDER_V1', reclassification_financial_transaction_id UUID UNIQUE REFERENCES financial_transactions(id),
  prepared_by UUID NOT NULL REFERENCES users(id), prepared_at TIMESTAMPTZ NOT NULL DEFAULT now(), approved_by UUID REFERENCES users(id), approved_at TIMESTAMPTZ, completed_by UUID REFERENCES users(id), completed_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(cycle_id,version_number), FOREIGN KEY(group_id,cycle_id) REFERENCES vsla_cycles(group_id,id), FOREIGN KEY(group_id,final_meeting_id) REFERENCES vsla_meetings(group_id,id)
);
CREATE UNIQUE INDEX one_live_shareout_per_cycle ON cycle_shareouts(cycle_id) WHERE status IN ('APPROVED','PAYOUT_IN_PROGRESS','COMPLETED');

CREATE TABLE cycle_shareout_entitlements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, shareout_id UUID NOT NULL REFERENCES cycle_shareouts(id), member_id UUID NOT NULL,
  member_code_snapshot VARCHAR(100) NOT NULL, member_name_snapshot VARCHAR(320) NOT NULL, net_shares BIGINT NOT NULL CHECK(net_shares>=0), net_savings NUMERIC(18,2) NOT NULL CHECK(net_savings>=0), raw_entitlement NUMERIC(24,8) NOT NULL CHECK(raw_entitlement>=0), base_rounded_entitlement NUMERIC(18,2) NOT NULL CHECK(base_rounded_entitlement>=0), rounding_adjustment NUMERIC(18,2) NOT NULL CHECK(rounding_adjustment IN (0,0.01)), final_entitlement NUMERIC(18,2) NOT NULL CHECK(final_entitlement=base_rounded_entitlement+rounding_adjustment), surplus_amount NUMERIC(18,2) NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(shareout_id,member_id), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id)
);

CREATE TABLE shareout_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, meeting_id UUID NOT NULL, shareout_id UUID NOT NULL REFERENCES cycle_shareouts(id), entitlement_id UUID NOT NULL REFERENCES cycle_shareout_entitlements(id), member_id UUID NOT NULL,
  transaction_kind VARCHAR(10) NOT NULL CHECK(transaction_kind IN ('PAYOUT','REVERSAL')), amount NUMERIC(18,2) NOT NULL CHECK(amount>0), original_shareout_payout_id UUID REFERENCES shareout_payouts(id), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id), CHECK((transaction_kind='PAYOUT' AND original_shareout_payout_id IS NULL) OR (transaction_kind='REVERSAL' AND original_shareout_payout_id IS NOT NULL))
);
CREATE UNIQUE INDEX one_reversal_per_shareout_payout ON shareout_payouts(original_shareout_payout_id) WHERE original_shareout_payout_id IS NOT NULL;

CREATE OR REPLACE FUNCTION enforce_one_active_shareout_payout() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.transaction_kind='PAYOUT' THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.entitlement_id::text,0));
    IF EXISTS(SELECT 1 FROM shareout_payouts p WHERE p.entitlement_id=NEW.entitlement_id AND p.transaction_kind='PAYOUT' AND NOT EXISTS(SELECT 1 FROM shareout_payouts r WHERE r.original_shareout_payout_id=p.id)) THEN
      RAISE EXCEPTION 'entitlement already paid' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER one_active_shareout_payout BEFORE INSERT ON shareout_payouts FOR EACH ROW EXECUTE FUNCTION enforce_one_active_shareout_payout();

CREATE TABLE cycle_social_fund_transfers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL REFERENCES vsla_groups(id), source_cycle_id UUID NOT NULL, target_cycle_id UUID NOT NULL, amount NUMERIC(18,2) NOT NULL CHECK(amount>0), source_financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), target_financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), idempotency_key VARCHAR(160) NOT NULL, request_fingerprint VARCHAR(128) NOT NULL, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(source_cycle_id), UNIQUE(organization_id,idempotency_key), CHECK(source_cycle_id<>target_cycle_id), FOREIGN KEY(group_id,source_cycle_id) REFERENCES vsla_cycles(group_id,id), FOREIGN KEY(group_id,target_cycle_id) REFERENCES vsla_cycles(group_id,id)
);

CREATE TRIGGER immutable_shareout_payouts BEFORE UPDATE OR DELETE ON shareout_payouts FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();
CREATE TRIGGER immutable_social_fund_transfers BEFORE UPDATE OR DELETE ON cycle_social_fund_transfers FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

INSERT INTO ledger_accounts(organization_id,group_id,cycle_id,account_code,account_name,account_category,normal_side,fund_type)
SELECT organization_id,group_id,id,'SHAREOUT_PAYABLE','Share-Out Payable','LIABILITY','CREDIT','SAVINGS_LOAN' FROM vsla_cycles
ON CONFLICT(cycle_id,account_code) DO NOTHING;

CREATE OR REPLACE FUNCTION ensure_cycle_loan_accounts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status IN ('READY','ACTIVE') THEN
    INSERT INTO ledger_accounts(organization_id,group_id,cycle_id,account_code,account_name,account_category,normal_side,fund_type) VALUES
      (NEW.organization_id,NEW.group_id,NEW.id,'LOANS_RECEIVABLE','Loans Receivable','ASSET','DEBIT','SAVINGS_LOAN'),
      (NEW.organization_id,NEW.group_id,NEW.id,'LOAN_SERVICE_CHARGE_INCOME','Loan Service Charge Income','INCOME','CREDIT','SAVINGS_LOAN'),
      (NEW.organization_id,NEW.group_id,NEW.id,'SHAREOUT_PAYABLE','Share-Out Payable','LIABILITY','CREDIT','SAVINGS_LOAN'),
      (NEW.organization_id,NEW.group_id,NEW.id,'SOCIAL_FUND_CASH','Social Fund Cash','ASSET','DEBIT','SOCIAL_FUND'),
      (NEW.organization_id,NEW.group_id,NEW.id,'SOCIAL_FUND_CONTROL','Social Fund Control','EQUITY','CREDIT','SOCIAL_FUND')
    ON CONFLICT(cycle_id,account_code) DO NOTHING;
  END IF;
  RETURN NEW;
END $$;
