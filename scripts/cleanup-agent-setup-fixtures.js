import fs from 'node:fs';
import pg from 'pg';

for (const line of fs.readFileSync('.env', 'utf8').split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, '');
}

const login = await fetch('http://localhost:3000/api/v1/auth/login', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '127.32.1.1' }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
if (!login.ok) throw new Error(`Cleanup login failed: ${login.status}`);
const cookie = login.headers.get('set-cookie').split(';', 1)[0];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const meetings = (await db.query(`SELECT m.id meeting_id,m.group_id FROM vsla_meetings m JOIN vsla_groups g ON g.id=m.group_id WHERE (g.name LIKE 'Unity Setup Group %' OR g.name LIKE 'Unity Savings Group %') AND g.status='ARCHIVED' AND m.status='OPEN'`)).rows;
for (const meeting of meetings) {
  const originals = (await db.query(`SELECT t.id FROM financial_transactions t WHERE t.meeting_id=$1 AND t.transaction_type<>'REVERSAL' AND NOT EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=t.id)`, [meeting.meeting_id])).rows;
  for (const transaction of originals) {
    const response = await fetch(`http://localhost:3000/api/v1/groups/${meeting.group_id}/meetings/${meeting.meeting_id}/transactions/${transaction.id}/reverse`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ idempotencyKey: `setup-cleanup-${transaction.id}` }) });
    if (!response.ok) throw new Error(`Cleanup reversal failed ${response.status}: ${await response.text()}`);
  }
  const cancel = await fetch(`http://localhost:3000/api/v1/groups/${meeting.group_id}/meetings/${meeting.meeting_id}/cancel`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ reason: 'Completed Agent setup acceptance cleanup' }) });
  if (!cancel.ok) throw new Error(`Cleanup cancellation failed ${cancel.status}: ${await cancel.text()}`);
}
const diagnostics = (await db.query(`SELECT (SELECT COUNT(*)::int FROM vsla_meetings m JOIN vsla_groups g ON g.id=m.group_id WHERE (g.name LIKE 'Unity Setup Group %' OR g.name LIKE 'Unity Savings Group %') AND m.status='OPEN') open_meetings,(SELECT COUNT(*)::int FROM pg_trigger WHERE (tgname LIKE 'agent_setup_%' OR tgname LIKE 'phase2fa1_%') AND NOT tgisinternal) temporary_triggers`)).rows[0];
await db.end();
if (diagnostics.open_meetings || diagnostics.temporary_triggers) throw new Error(`Cleanup incomplete: ${JSON.stringify(diagnostics)}`);
console.log(JSON.stringify({ cleanedMeetings: meetings.length, ...diagnostics }, null, 2));
