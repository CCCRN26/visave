import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}
const login = await fetch("http://localhost:3000/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie").split(";", 1)[0];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const fixture = (await db.query(`SELECT g.id group_id,l.id loan_id,l.member_id,m.id meeting_id FROM vsla_groups g JOIN loans l ON l.group_id=g.id JOIN vsla_meetings m ON m.id=l.disbursement_meeting_id WHERE g.name='Phase 2B Acceptance Group' ORDER BY l.created_at DESC LIMIT 1`)).rows[0];
await db.end();
if (!fixture) throw new Error("Phase 2C page fixture not found");
const paths = [`/groups/${fixture.group_id}`, `/groups/${fixture.group_id}/loans`, `/groups/${fixture.group_id}/loans/${fixture.loan_id}`, `/groups/${fixture.group_id}/members/${fixture.member_id}`, `/groups/${fixture.group_id}/meetings`, `/groups/${fixture.group_id}/meetings/${fixture.meeting_id}`];
const results = [];
for (const path of paths) {
  const response = await fetch(`http://localhost:3000${path}`, { headers: { cookie }, redirect: "manual" });
  const html = await response.text();
  const invalid = ["Invalid Date", "[object Date]", ">NaN<"].filter(value => html.includes(value));
  if (response.status !== 200 || invalid.length) throw new Error(JSON.stringify({ path, status: response.status, invalid }));
  results.push({ path, status: response.status, invalid });
}
console.log(JSON.stringify(results, null, 2));
