CREATE TABLE ledger_accounts (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL REFERENCES vsla_groups(id), cycle_id UUID NOT NULL REFERENCES vsla_cycles(id),
 account_code VARCHAR(40) NOT NULL, account_name VARCHAR(120) NOT NULL, account_category VARCHAR(30) NOT NULL CHECK(account_category IN ('ASSET','EQUITY','INCOME')), normal_side VARCHAR(6) NOT NULL CHECK(normal_side IN ('DEBIT','CREDIT')), fund_type VARCHAR(20) NOT NULL CHECK(fund_type IN ('SAVINGS_LOAN','SOCIAL_FUND')), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 UNIQUE(cycle_id,account_code), UNIQUE(cycle_id,id)
);
CREATE INDEX ledger_accounts_group_cycle_idx ON ledger_accounts(group_id,cycle_id);

CREATE TABLE vsla_meetings (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL REFERENCES vsla_groups(id), cycle_id UUID NOT NULL,
 meeting_number INTEGER NOT NULL CHECK(meeting_number>0), meeting_code VARCHAR(160) NOT NULL UNIQUE, meeting_date DATE NOT NULL, status VARCHAR(12) NOT NULL CHECK(status IN ('OPEN','CLOSED','CANCELLED')),
 opening_savings_loan_balance NUMERIC(18,2) NOT NULL DEFAULT 0, opening_social_fund_balance NUMERIC(18,2) NOT NULL DEFAULT 0,
 opened_by UUID NOT NULL REFERENCES users(id), opened_at TIMESTAMPTZ NOT NULL DEFAULT now(), closed_by UUID REFERENCES users(id), closed_at TIMESTAMPTZ, cancelled_by UUID REFERENCES users(id), cancelled_at TIMESTAMPTZ, cancellation_reason TEXT,
 created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,cycle_id) REFERENCES vsla_cycles(group_id,id), UNIQUE(cycle_id,meeting_number), UNIQUE(group_id,id), UNIQUE(cycle_id,id)
);
CREATE UNIQUE INDEX one_open_meeting_per_cycle ON vsla_meetings(cycle_id) WHERE status='OPEN';
CREATE INDEX meetings_group_cycle_date_idx ON vsla_meetings(group_id,cycle_id,meeting_date DESC);

CREATE TABLE meeting_attendance (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), meeting_id UUID NOT NULL, group_id UUID NOT NULL, cycle_id UUID NOT NULL, member_id UUID NOT NULL,
 attendance_status VARCHAR(12) NOT NULL DEFAULT 'UNMARKED' CHECK(attendance_status IN ('UNMARKED','PRESENT','LATE','ABSENT','EXCUSED')), notes TEXT, recorded_by UUID REFERENCES users(id), recorded_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,meeting_id) REFERENCES vsla_meetings(group_id,id), FOREIGN KEY(cycle_id,meeting_id) REFERENCES vsla_meetings(cycle_id,id), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id), UNIQUE(meeting_id,member_id)
);
CREATE INDEX attendance_meeting_status_idx ON meeting_attendance(meeting_id,attendance_status);

CREATE TABLE financial_transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, meeting_id UUID NOT NULL, member_id UUID,
 transaction_type VARCHAR(40) NOT NULL CHECK(transaction_type IN ('SAVINGS_PURCHASE','SAVINGS_REVERSAL','SOCIAL_FUND_CONTRIBUTION','SOCIAL_FUND_REVERSAL','FINE','FINE_REVERSAL')),
 reference_code VARCHAR(80) NOT NULL UNIQUE, effective_date DATE NOT NULL, reversal_of_transaction_id UUID REFERENCES financial_transactions(id), idempotency_key VARCHAR(160) NOT NULL, request_fingerprint VARCHAR(128) NOT NULL,
 created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), metadata JSONB,
 FOREIGN KEY(group_id,meeting_id) REFERENCES vsla_meetings(group_id,id), FOREIGN KEY(cycle_id,meeting_id) REFERENCES vsla_meetings(cycle_id,id), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id), UNIQUE(organization_id,idempotency_key)
);
CREATE UNIQUE INDEX one_reversal_per_transaction ON financial_transactions(reversal_of_transaction_id) WHERE reversal_of_transaction_id IS NOT NULL;
CREATE INDEX financial_transactions_meeting_created_idx ON financial_transactions(meeting_id,created_at); CREATE INDEX financial_transactions_member_idx ON financial_transactions(member_id,created_at); CREATE INDEX financial_transactions_type_idx ON financial_transactions(transaction_type);

CREATE TABLE ledger_entries (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), financial_transaction_id UUID NOT NULL REFERENCES financial_transactions(id), ledger_account_id UUID NOT NULL REFERENCES ledger_accounts(id), entry_side VARCHAR(6) NOT NULL CHECK(entry_side IN ('DEBIT','CREDIT')), amount NUMERIC(18,2) NOT NULL CHECK(amount>0), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ledger_entries_transaction_idx ON ledger_entries(financial_transaction_id); CREATE INDEX ledger_entries_account_idx ON ledger_entries(ledger_account_id);

CREATE TABLE savings_transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, meeting_id UUID NOT NULL, member_id UUID NOT NULL,
 transaction_kind VARCHAR(12) NOT NULL CHECK(transaction_kind IN ('PURCHASE','REVERSAL')), shares INTEGER NOT NULL CHECK(shares>0), share_value NUMERIC(18,2) NOT NULL CHECK(share_value>0), amount NUMERIC(18,2) NOT NULL CHECK(amount>0), original_savings_transaction_id UUID REFERENCES savings_transactions(id), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id)
);
CREATE INDEX savings_member_cycle_idx ON savings_transactions(member_id,cycle_id); CREATE INDEX savings_meeting_idx ON savings_transactions(meeting_id);

CREATE TABLE social_fund_transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, meeting_id UUID NOT NULL, member_id UUID NOT NULL,
 transaction_kind VARCHAR(15) NOT NULL CHECK(transaction_kind IN ('CONTRIBUTION','REVERSAL')), amount NUMERIC(18,2) NOT NULL CHECK(amount>0), original_social_fund_transaction_id UUID REFERENCES social_fund_transactions(id), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id)
);
CREATE INDEX social_meeting_member_idx ON social_fund_transactions(meeting_id,member_id); CREATE INDEX social_member_cycle_idx ON social_fund_transactions(member_id,cycle_id);

CREATE TABLE fine_transactions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, meeting_id UUID NOT NULL, member_id UUID NOT NULL, fine_rule_id UUID NOT NULL REFERENCES constitution_fine_rules(id),
 transaction_kind VARCHAR(10) NOT NULL CHECK(transaction_kind IN ('FINE','REVERSAL')), amount NUMERIC(18,2) NOT NULL CHECK(amount>0), reason TEXT, original_fine_transaction_id UUID REFERENCES fine_transactions(id), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id)
);
CREATE INDEX fines_meeting_member_rule_idx ON fine_transactions(meeting_id,member_id,fine_rule_id); CREATE INDEX fines_member_cycle_idx ON fine_transactions(member_id,cycle_id);

CREATE TABLE meeting_reconciliations (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, meeting_id UUID NOT NULL,
 expected_savings_loan_balance NUMERIC(18,2) NOT NULL, counted_savings_loan_balance NUMERIC(18,2) NOT NULL CHECK(counted_savings_loan_balance>=0), savings_loan_difference NUMERIC(18,2) GENERATED ALWAYS AS (counted_savings_loan_balance-expected_savings_loan_balance) STORED,
 expected_social_fund_balance NUMERIC(18,2) NOT NULL, counted_social_fund_balance NUMERIC(18,2) NOT NULL CHECK(counted_social_fund_balance>=0), social_fund_difference NUMERIC(18,2) GENERATED ALWAYS AS (counted_social_fund_balance-expected_social_fund_balance) STORED,
 status VARCHAR(10) GENERATED ALWAYS AS (CASE WHEN counted_savings_loan_balance=expected_savings_loan_balance AND counted_social_fund_balance=expected_social_fund_balance THEN 'BALANCED' ELSE 'VARIANCE' END) STORED,
 notes TEXT, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), FOREIGN KEY(group_id,meeting_id) REFERENCES vsla_meetings(group_id,id)
);
CREATE INDEX reconciliations_meeting_created_idx ON meeting_reconciliations(meeting_id,created_at DESC);

CREATE OR REPLACE FUNCTION reject_financial_mutation() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'financial records are append-only' USING ERRCODE='55000'; END $$;
CREATE TRIGGER immutable_financial_transactions BEFORE UPDATE OR DELETE ON financial_transactions FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();
CREATE TRIGGER immutable_ledger_entries BEFORE UPDATE OR DELETE ON ledger_entries FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();
CREATE TRIGGER immutable_savings_transactions BEFORE UPDATE OR DELETE ON savings_transactions FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();
CREATE TRIGGER immutable_social_transactions BEFORE UPDATE OR DELETE ON social_fund_transactions FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();
CREATE TRIGGER immutable_fine_transactions BEFORE UPDATE OR DELETE ON fine_transactions FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

CREATE OR REPLACE FUNCTION assert_balanced_financial_transaction() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target UUID; debits NUMERIC(18,2); credits NUMERIC(18,2);
BEGIN target:=COALESCE(NEW.financial_transaction_id,OLD.financial_transaction_id); SELECT COALESCE(SUM(amount) FILTER(WHERE entry_side='DEBIT'),0),COALESCE(SUM(amount) FILTER(WHERE entry_side='CREDIT'),0) INTO debits,credits FROM ledger_entries WHERE financial_transaction_id=target; IF debits<>credits OR debits=0 THEN RAISE EXCEPTION 'unbalanced financial transaction %: debits %, credits %',target,debits,credits USING ERRCODE='23514'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER financial_transaction_must_balance AFTER INSERT ON ledger_entries DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_balanced_financial_transaction();

INSERT INTO ledger_accounts(organization_id,group_id,cycle_id,account_code,account_name,account_category,normal_side,fund_type)
SELECT c.organization_id,c.group_id,c.id,v.code,v.name,v.category,v.side,v.fund FROM vsla_cycles c CROSS JOIN (VALUES
 ('SAVINGS_LOAN_CASH','Savings/Loan Cash','ASSET','DEBIT','SAVINGS_LOAN'),('SOCIAL_FUND_CASH','Social Fund Cash','ASSET','DEBIT','SOCIAL_FUND'),('MEMBER_SAVINGS_CONTROL','Member Savings Control','EQUITY','CREDIT','SAVINGS_LOAN'),('SOCIAL_FUND_CONTROL','Social Fund Control','EQUITY','CREDIT','SOCIAL_FUND'),('FINE_INCOME','Fine Income','INCOME','CREDIT','SAVINGS_LOAN')) v(code,name,category,side,fund)
WHERE c.status='ACTIVE' ON CONFLICT(cycle_id,account_code) DO NOTHING;
