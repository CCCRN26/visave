ALTER TABLE financial_transactions DROP CONSTRAINT financial_transactions_transaction_type_check;
ALTER TABLE financial_transactions ADD CONSTRAINT financial_transactions_transaction_type_check CHECK(transaction_type IN ('SAVINGS_PURCHASE','SAVINGS_REVERSAL','SOCIAL_FUND_CONTRIBUTION','SOCIAL_FUND_REVERSAL','FINE','FINE_REVERSAL','LOAN_DISBURSEMENT','LOAN_DISBURSEMENT_REVERSAL','LOAN_REPAYMENT','LOAN_REPAYMENT_REVERSAL'));

CREATE TABLE loan_requests (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, member_id UUID NOT NULL, request_meeting_id UUID NOT NULL,
 request_code VARCHAR(80) NOT NULL UNIQUE, requested_principal NUMERIC(18,2) NOT NULL CHECK(requested_principal>0), requested_term_months INTEGER NOT NULL CHECK(requested_term_months>0), purpose TEXT,
 savings_snapshot NUMERIC(18,2) NOT NULL CHECK(savings_snapshot>=0), maximum_eligible_snapshot NUMERIC(18,2) NOT NULL CHECK(maximum_eligible_snapshot>=0), status VARCHAR(12) NOT NULL CHECK(status IN('PENDING','APPROVED','REJECTED','CANCELLED','DISBURSED')),
 requested_by UUID NOT NULL REFERENCES users(id), requested_at TIMESTAMPTZ NOT NULL DEFAULT now(), cancelled_by UUID REFERENCES users(id), cancelled_at TIMESTAMPTZ, cancellation_reason TEXT, created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,cycle_id) REFERENCES vsla_cycles(group_id,id), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id), FOREIGN KEY(group_id,request_meeting_id) REFERENCES vsla_meetings(group_id,id), UNIQUE(group_id,id)
);
CREATE INDEX loan_requests_group_status_idx ON loan_requests(group_id,status,requested_at DESC); CREATE INDEX loan_requests_member_cycle_idx ON loan_requests(member_id,cycle_id);

CREATE TABLE loan_decisions (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), loan_request_id UUID NOT NULL UNIQUE REFERENCES loan_requests(id), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, member_id UUID NOT NULL, decision_meeting_id UUID NOT NULL,
 decision VARCHAR(10) NOT NULL CHECK(decision IN('APPROVED','REJECTED')), approved_principal NUMERIC(18,2) CHECK(approved_principal IS NULL OR approved_principal>0), approved_term_months INTEGER CHECK(approved_term_months IS NULL OR approved_term_months>0), savings_snapshot NUMERIC(18,2) NOT NULL CHECK(savings_snapshot>=0), maximum_eligible_snapshot NUMERIC(18,2) NOT NULL CHECK(maximum_eligible_snapshot>=0), notes TEXT, decided_by UUID NOT NULL REFERENCES users(id), decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,decision_meeting_id) REFERENCES vsla_meetings(group_id,id), CHECK((decision='APPROVED' AND approved_principal IS NOT NULL AND approved_term_months IS NOT NULL) OR (decision='REJECTED' AND approved_principal IS NULL AND approved_term_months IS NULL))
);

CREATE TABLE loans (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, member_id UUID NOT NULL, loan_request_id UUID NOT NULL UNIQUE REFERENCES loan_requests(id), loan_decision_id UUID NOT NULL UNIQUE REFERENCES loan_decisions(id), constitution_id UUID NOT NULL REFERENCES group_constitutions(id),
 loan_code VARCHAR(80) NOT NULL UNIQUE, disbursement_meeting_id UUID NOT NULL, disbursement_financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), principal_disbursed NUMERIC(18,2) NOT NULL CHECK(principal_disbursed>0), service_charge_rate NUMERIC(7,4) NOT NULL CHECK(service_charge_rate>=0), term_months INTEGER NOT NULL CHECK(term_months>0), service_charge_total_due NUMERIC(18,2) NOT NULL CHECK(service_charge_total_due>=0), total_contractual_due NUMERIC(18,2) NOT NULL CHECK(total_contractual_due=principal_disbursed+service_charge_total_due), disbursement_date DATE NOT NULL, due_date DATE NOT NULL CHECK(due_date>=disbursement_date), settled_at TIMESTAMPTZ, voided_at TIMESTAMPTZ, defaulted_at TIMESTAMPTZ, defaulted_by UUID REFERENCES users(id), default_reason TEXT, created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(group_id,cycle_id) REFERENCES vsla_cycles(group_id,id), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id), FOREIGN KEY(group_id,disbursement_meeting_id) REFERENCES vsla_meetings(group_id,id), UNIQUE(group_id,id)
);
CREATE UNIQUE INDEX one_outstanding_loan_per_member_cycle ON loans(member_id,cycle_id) WHERE settled_at IS NULL AND voided_at IS NULL; CREATE INDEX loans_group_member_idx ON loans(group_id,member_id,created_at DESC); CREATE INDEX loans_due_idx ON loans(due_date) WHERE settled_at IS NULL AND voided_at IS NULL;

CREATE TABLE loan_repayments (
 id UUID PRIMARY KEY DEFAULT gen_random_uuid(), financial_transaction_id UUID NOT NULL UNIQUE REFERENCES financial_transactions(id), organization_id UUID NOT NULL REFERENCES organizations(id), group_id UUID NOT NULL, cycle_id UUID NOT NULL, meeting_id UUID NOT NULL, loan_id UUID NOT NULL REFERENCES loans(id), member_id UUID NOT NULL, transaction_kind VARCHAR(10) NOT NULL CHECK(transaction_kind IN('PAYMENT','REVERSAL')), payment_amount NUMERIC(18,2) NOT NULL CHECK(payment_amount>0), principal_component NUMERIC(18,2) NOT NULL CHECK(principal_component>=0), service_charge_component NUMERIC(18,2) NOT NULL CHECK(service_charge_component>=0), original_loan_repayment_id UUID REFERENCES loan_repayments(id), created_by UUID NOT NULL REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now(), CHECK(payment_amount=principal_component+service_charge_component), FOREIGN KEY(group_id,member_id) REFERENCES group_members(group_id,id)
);
CREATE INDEX loan_repayments_loan_created_idx ON loan_repayments(loan_id,created_at); CREATE INDEX loan_repayments_meeting_idx ON loan_repayments(meeting_id);
CREATE TRIGGER immutable_loan_repayments BEFORE UPDATE OR DELETE ON loan_repayments FOR EACH ROW EXECUTE FUNCTION reject_financial_mutation();

INSERT INTO ledger_accounts(organization_id,group_id,cycle_id,account_code,account_name,account_category,normal_side,fund_type)
SELECT c.organization_id,c.group_id,c.id,v.code,v.name,v.category,v.side,'SAVINGS_LOAN' FROM vsla_cycles c CROSS JOIN(VALUES ('LOANS_RECEIVABLE','Loans Receivable','ASSET','DEBIT'),('LOAN_SERVICE_CHARGE_INCOME','Loan Service Charge Income','INCOME','CREDIT'))v(code,name,category,side)
WHERE c.status='ACTIVE' ON CONFLICT(cycle_id,account_code) DO NOTHING;
