import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}
const login = await fetch("http://localhost:3000/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "phase2a.isolation@example.org", password: "Isolation-Test-2026!" }) });
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie").split(";", 1)[0];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const fixture = (await db.query(`SELECT s.group_id,s.cycle_id,s.final_meeting_id meeting_id,s.id shareout_id,p.id payout_id,e.id entitlement_id FROM cycle_shareouts s JOIN cycle_shareout_entitlements e ON e.shareout_id=s.id LEFT JOIN shareout_payouts p ON p.shareout_id=s.id AND p.transaction_kind='PAYOUT' JOIN vsla_groups g ON g.id=s.group_id WHERE g.group_code LIKE 'PHASE2D-%' ORDER BY s.created_at DESC LIMIT 1`)).rows[0];
await db.end();
if (!fixture) throw new Error("Phase 2D RBAC fixture not found");
const key = () => `phase2d-rbac-${crypto.randomUUID()}`;
const requests = [
  ["GET", `/api/v1/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/shareout/readiness`],
  ["GET", `/api/v1/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/shareout`],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/shareout/prepare`, {}],
  ["POST", `/api/v1/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/shareout/${fixture.shareout_id}/approve`, { idempotencyKey: key() }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/shareout/${fixture.shareout_id}/payouts`, { entitlementId: fixture.entitlement_id, idempotencyKey: key() }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/shareout/${fixture.shareout_id}/payouts/${fixture.payout_id}/reverse`, { idempotencyKey: key() }],
  ["POST", `/api/v1/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/shareout/${fixture.shareout_id}/complete`, {}],
  ["POST", `/api/v1/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/social-fund/carry-forward`, { targetCycleId: fixture.cycle_id, idempotencyKey: key() }],
  ["GET", `/api/v1/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/closure/readiness`],
  ["POST", `/api/v1/groups/${fixture.group_id}/cycles/${fixture.cycle_id}/close`, {}],
];
const results = [];
for (const [method, path, body] of requests) {
  const response = await fetch(`http://localhost:3000${path}`, { method, headers: { cookie, ...(body === undefined ? {} : { "content-type": "application/json" }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  if (response.status !== 403) throw new Error(`${method} ${path}: expected 403, got ${response.status}`);
  results.push({ method, path, status: 403 });
}
console.log(JSON.stringify(results, null, 2));
