import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
const base = "http://localhost:3000";
await db.connect();
try {
  const login = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  const cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const loans = (await db.query(`SELECT l.id,l.group_id,l.disbursement_meeting_id meeting_id,l.disbursement_financial_transaction_id transaction_id FROM loans l JOIN vsla_groups g ON g.id=l.group_id JOIN vsla_meetings m ON m.id=l.disbursement_meeting_id JOIN vsla_cycles c ON c.id=l.cycle_id WHERE g.group_code LIKE 'PHASE2D-%' AND l.settled_at IS NULL AND l.voided_at IS NULL AND m.status='OPEN' AND c.status='ACTIVE'`)).rows;
  for (const loan of loans) {
    await db.query("UPDATE vsla_groups SET status='ACTIVE' WHERE id=$1", [loan.group_id]);
    const response = await fetch(`${base}/api/v1/groups/${loan.group_id}/meetings/${loan.meeting_id}/loans/${loan.id}/transactions/${loan.transaction_id}/reverse`, { method: "POST", headers: { cookie, "content-type": "application/json" }, body: JSON.stringify({ idempotencyKey: `phase2d-cleanup-${crypto.randomUUID()}` }) });
    if (!response.ok) throw new Error(`Loan cleanup failed: ${response.status} ${(await response.text()).slice(0, 200)}`);
  }
  await db.query("BEGIN");
  await db.query(`UPDATE vsla_meetings SET status='CANCELLED',cancellation_reason='Phase 2D isolated fixture cleanup',cancelled_at=COALESCE(cancelled_at,now()),updated_at=now() WHERE group_id IN(SELECT id FROM vsla_groups WHERE group_code LIKE 'PHASE2D-%') AND status='OPEN'`);
  await db.query(`UPDATE vsla_cycles SET status='CANCELLED',updated_at=now() WHERE group_id IN(SELECT id FROM vsla_groups WHERE group_code LIKE 'PHASE2D-%') AND status IN('DRAFT','READY','ACTIVE','CLOSING')`);
  await db.query(`UPDATE vsla_groups SET status='ARCHIVED',updated_at=now() WHERE group_code LIKE 'PHASE2D-%'`);
  await db.query("COMMIT");
  const proof = (await db.query(`SELECT COUNT(DISTINCT g.id) FILTER(WHERE g.status<>'ARCHIVED')::int non_archived_groups,COUNT(DISTINCT m.id) FILTER(WHERE m.status='OPEN')::int open_meetings,COUNT(DISTINCT l.id) FILTER(WHERE l.settled_at IS NULL AND l.voided_at IS NULL)::int outstanding_loans FROM vsla_groups g LEFT JOIN vsla_meetings m ON m.group_id=g.id LEFT JOIN loans l ON l.group_id=g.id WHERE g.group_code LIKE 'PHASE2D-%'`)).rows[0];
  console.log(JSON.stringify({ reversedLoans: loans.length, ...proof }, null, 2));
} catch (error) {
  await db.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await db.end();
}
