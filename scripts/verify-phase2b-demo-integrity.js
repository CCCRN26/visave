import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}

const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const groups = (await db.query(`SELECT g.group_code,g.status,
  (SELECT COUNT(*)::int FROM vsla_cycles c WHERE c.group_id=g.id AND c.status='ACTIVE') active_cycles,
  (SELECT COUNT(*)::int FROM group_constitutions c WHERE c.group_id=g.id AND c.status='APPROVED') approved_constitutions,
  (SELECT COUNT(*)::int FROM group_members m WHERE m.group_id=g.id AND m.status='ACTIVE') active_members,
  (SELECT COUNT(*)::int FROM group_officer_assignments o JOIN vsla_cycles c ON c.id=o.cycle_id WHERE o.group_id=g.id AND o.status='ACTIVE' AND c.status='ACTIVE') active_officers,
  (SELECT COUNT(*)::int FROM vsla_meetings m WHERE m.group_id=g.id AND m.status='OPEN') open_meetings,
  (SELECT COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.ledger_account_id JOIN vsla_cycles c ON c.id=a.cycle_id WHERE a.group_id=g.id AND a.account_code='SAVINGS_LOAN_CASH' AND c.status='ACTIVE') savings_loan_cash,
  (SELECT COALESCE(SUM(CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END),0)::numeric(18,2) FROM ledger_entries e JOIN ledger_accounts a ON a.id=e.ledger_account_id JOIN vsla_cycles c ON c.id=a.cycle_id WHERE a.group_id=g.id AND a.account_code='SOCIAL_FUND_CASH' AND c.status='ACTIVE') social_fund_cash
  FROM vsla_groups g WHERE g.group_code IN('CCCRN-NIG-0005','CCCRN-NIG-0006') ORDER BY g.group_code`)).rows;
const temporaryHardeningGroups = (await db.query("SELECT COUNT(*)::int n FROM vsla_groups WHERE name LIKE 'Hardening %' ")).rows[0].n;
const temporaryFineRules = (await db.query("SELECT COUNT(*)::int n FROM constitution_fine_rules WHERE code IN('FOREIGN','OLD_VERSION')")).rows[0].n;
const protections = (await db.query(`SELECT 'INDEX' protection_kind,indexname protection_name FROM pg_indexes
  WHERE schemaname='public' AND indexname IN('one_open_meeting_per_cycle','one_reversal_per_transaction','vsla_meetings_cycle_id_meeting_number_key','meeting_attendance_meeting_id_member_id_key','financial_transactions_organization_id_idempotency_key_key')
  UNION ALL SELECT 'TRIGGER',trigger_name FROM information_schema.triggers
  WHERE event_object_schema='public' AND trigger_name IN('immutable_financial_transactions','immutable_ledger_entries','immutable_savings_transactions','immutable_social_transactions','immutable_fine_transactions','financial_transaction_must_balance','financial_header_must_balance','one_active_social_contribution_per_member_meeting')
  ORDER BY protection_kind,protection_name`)).rows;
console.log(JSON.stringify({ groups, temporaryHardeningGroups, temporaryFineRules, protections }, null, 2));
await db.end();
if (groups.length !== 2 || groups.some((group) => group.status !== "ACTIVE" || group.active_cycles !== 1 || group.approved_constitutions !== 1 || group.active_members < 15 || group.active_members > 25 || group.active_officers !== 5 || group.open_meetings !== 0) || temporaryHardeningGroups || temporaryFineRules) process.exitCode = 1;
