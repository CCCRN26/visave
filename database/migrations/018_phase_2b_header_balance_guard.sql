CREATE OR REPLACE FUNCTION assert_financial_header_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE debits NUMERIC(18,2); credits NUMERIC(18,2);
BEGIN SELECT COALESCE(SUM(amount) FILTER(WHERE entry_side='DEBIT'),0),COALESCE(SUM(amount) FILTER(WHERE entry_side='CREDIT'),0) INTO debits,credits FROM ledger_entries WHERE financial_transaction_id=NEW.id; IF debits<>credits OR debits=0 THEN RAISE EXCEPTION 'unbalanced financial transaction %: debits %, credits %',NEW.id,debits,credits USING ERRCODE='23514'; END IF; RETURN NULL; END $$;
CREATE CONSTRAINT TRIGGER financial_header_must_balance AFTER INSERT ON financial_transactions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION assert_financial_header_balanced();
