CREATE OR REPLACE FUNCTION ensure_cycle_loan_accounts()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status = 'ACTIVE' THEN
    INSERT INTO ledger_accounts (
      organization_id,
      group_id,
      cycle_id,
      account_code,
      account_name,
      account_category,
      normal_side,
      fund_type
    )
    VALUES
      (NEW.organization_id, NEW.group_id, NEW.id, 'LOANS_RECEIVABLE', 'Loans Receivable', 'ASSET', 'DEBIT', 'SAVINGS_LOAN'),
      (NEW.organization_id, NEW.group_id, NEW.id, 'LOAN_SERVICE_CHARGE_INCOME', 'Loan Service Charge Income', 'INCOME', 'CREDIT', 'SAVINGS_LOAN')
    ON CONFLICT (cycle_id, account_code) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS ensure_cycle_loan_accounts_trigger ON vsla_cycles;
CREATE TRIGGER ensure_cycle_loan_accounts_trigger
AFTER INSERT OR UPDATE OF status ON vsla_cycles
FOR EACH ROW
EXECUTE FUNCTION ensure_cycle_loan_accounts();

INSERT INTO ledger_accounts (
  organization_id,
  group_id,
  cycle_id,
  account_code,
  account_name,
  account_category,
  normal_side,
  fund_type
)
SELECT
  cycle.organization_id,
  cycle.group_id,
  cycle.id,
  account.account_code,
  account.account_name,
  account.account_category,
  account.normal_side,
  'SAVINGS_LOAN'
FROM vsla_cycles cycle
CROSS JOIN (
  VALUES
    ('LOANS_RECEIVABLE', 'Loans Receivable', 'ASSET', 'DEBIT'),
    ('LOAN_SERVICE_CHARGE_INCOME', 'Loan Service Charge Income', 'INCOME', 'CREDIT')
) AS account(account_code, account_name, account_category, normal_side)
WHERE cycle.status = 'ACTIVE'
ON CONFLICT (cycle_id, account_code) DO NOTHING;
