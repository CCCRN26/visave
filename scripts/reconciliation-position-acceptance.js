import fs from "node:fs";
import pg from "pg";
import { financialPosition } from "../src/modules/meetings/meeting.repository.js";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) {
    process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
  }
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const results = [];
function expect(name, actual, expected) {
  const pass = String(actual) === String(expected);
  results.push({ name, pass, actual, expected });
  if (!pass) throw new Error(`${name}: expected ${expected}, received ${actual}`);
}

await db.connect();
try {
  await db.query("BEGIN");
  await db.query(`
    CREATE TEMP TABLE vsla_meetings(id text PRIMARY KEY,cycle_id text,meeting_number int,meeting_date date);
    CREATE TEMP TABLE savings_transactions(meeting_id text,cycle_id text,transaction_kind text,amount numeric(18,2));
    CREATE TEMP TABLE social_fund_transactions(meeting_id text,cycle_id text,transaction_kind text,amount numeric(18,2));
    CREATE TEMP TABLE fine_transactions(meeting_id text,cycle_id text,transaction_kind text,amount numeric(18,2));
    CREATE TEMP TABLE financial_transactions(id text PRIMARY KEY,meeting_id text,transaction_type text);
    CREATE TEMP TABLE ledger_accounts(id text PRIMARY KEY,cycle_id text,account_code text);
    CREATE TEMP TABLE ledger_entries(financial_transaction_id text,ledger_account_id text,entry_side text,amount numeric(18,2));

    INSERT INTO vsla_meetings VALUES
      ('m1','c1',1,'2026-01-01'),('m2','c1',2,'2026-01-01'),
      ('m3','c1',3,'2026-01-08'),('m4','c1',4,'2026-01-15'),
      ('r1','cr',1,'2026-02-01'),('r2','cr',2,'2026-02-08'),
      ('x1','c2',1,'2026-03-01');
    INSERT INTO savings_transactions VALUES
      ('m1','c1','PURCHASE',10000),('m2','c1','PURCHASE',5000),
      ('m3','c1','PURCHASE',35000),('m4','c1','PURCHASE',12000),
      ('r1','cr','PURCHASE',15000),('r1','cr','PURCHASE',5000),
      ('r2','cr','REVERSAL',5000),('x1','c2','PURCHASE',5000);
    INSERT INTO social_fund_transactions VALUES ('m4','c1','CONTRIBUTION',2000);
    INSERT INTO fine_transactions VALUES ('m4','c1','FINE',100);

    INSERT INTO ledger_accounts VALUES
      ('c1-cash','c1','SAVINGS_LOAN_CASH'),('c1-loans','c1','LOANS_RECEIVABLE'),
      ('c1-income','c1','LOAN_SERVICE_CHARGE_INCOME'),('c1-social-cash','c1','SOCIAL_FUND_CASH'),
      ('c1-social-control','c1','SOCIAL_FUND_CONTROL');
    INSERT INTO financial_transactions VALUES
      ('loan-out','m1','LOAN_DISBURSEMENT'),('loan-in','m2','LOAN_REPAYMENT'),
      ('social','m4','SOCIAL_FUND_CONTRIBUTION');
    INSERT INTO ledger_entries VALUES
      ('loan-out','c1-loans','DEBIT',9000),('loan-out','c1-cash','CREDIT',9000),
      ('loan-in','c1-cash','DEBIT',3000),('loan-in','c1-loans','CREDIT',2500),
      ('loan-in','c1-income','CREDIT',500),('social','c1-social-cash','DEBIT',2000),
      ('social','c1-social-control','CREDIT',2000);
  `);

  const first = await financialPosition(db, "m1");
  expect("1 first meeting previous savings", first.previous_savings, "0.00");
  expect("1 first meeting current savings", first.current_savings, "10000.00");
  expect("1 first meeting cycle total", first.total_savings, "10000.00");

  const second = await financialPosition(db, "m2");
  expect("2 second meeting previous savings", second.previous_savings, "10000.00");
  expect("2 second meeting current savings", second.current_savings, "5000.00");
  expect("2 second meeting cycle total", second.total_savings, "15000.00");
  expect("7 same-date meeting is scoped by meeting id", second.current_savings, "5000.00");

  const fourth = await financialPosition(db, "m4");
  expect("3 third example previous savings", fourth.previous_savings, "50000.00");
  expect("3 third example current savings", fourth.current_savings, "12000.00");
  expect("3 third example cycle total", fourth.total_savings, "62000.00");
  expect("5 Social Fund is excluded from savings", fourth.total_savings, "62000.00");
  expect("5 Social Fund contribution total", fourth.total_social_fund, "2000.00");
  expect("5 Social Fund cash position", fourth.social_fund_balance, "2000.00");

  expect("6 prior loan disbursements", second.previous_loan_disbursements, "9000.00");
  expect("6 current meeting loan repayments", second.current_loan_repayments, "3000.00");
  expect("6 outstanding principal before meeting", second.outstanding_principal_before, "9000.00");
  expect("6 outstanding principal now", second.outstanding_principal_now, "6500.00");

  const reversed = await financialPosition(db, "r2");
  expect("4 reversals reduce cumulative savings", reversed.total_savings, "15000.00");

  const nextCycle = await financialPosition(db, "x1");
  expect("8 prior cycle is excluded", nextCycle.previous_savings, "0.00");
  expect("8 current cycle total", nextCycle.total_savings, "5000.00");

  const integrity = (await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE difference<>0)::int unbalanced,
      (SELECT COUNT(*)::int FROM ledger_entries e LEFT JOIN financial_transactions f ON f.id=e.financial_transaction_id WHERE f.id IS NULL) orphaned
    FROM (
      SELECT financial_transaction_id,
        SUM(CASE entry_side WHEN 'DEBIT' THEN amount ELSE -amount END) difference
      FROM ledger_entries GROUP BY financial_transaction_id
    ) x
  `)).rows[0];
  expect("10 unbalanced fixture transactions", integrity.unbalanced, 0);
  expect("10 orphan fixture ledger entries", integrity.orphaned, 0);
} finally {
  await db.query("ROLLBACK").catch(() => {});
  await db.end();
}

for (const result of results) {
  console.log(`${result.pass ? "PASS" : "FAIL"} ${result.name}: ${result.actual}`);
}
console.log(`Reconciliation position acceptance: ${results.filter((x) => x.pass).length}/${results.length} PASS`);
