import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}

const login = await fetch("http://localhost:3000/api/v1/auth/login", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "phase2a.isolation@example.org", password: "Isolation-Test-2026!" }),
});
if (!login.ok) throw new Error(`Login failed: ${login.status}`);
const cookie = login.headers.get("set-cookie").split(";", 1)[0];
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
const fixture = (await db.query(`
  SELECT g.id group_id, m.id meeting_id, l.id loan_id, l.loan_request_id request_id,
         l.disbursement_financial_transaction_id transaction_id, l.member_id,
         ft.idempotency_key
  FROM vsla_groups g
  JOIN loans l ON l.group_id = g.id
  JOIN vsla_meetings m ON m.id = l.disbursement_meeting_id
  JOIN financial_transactions ft ON ft.id = l.disbursement_financial_transaction_id
  WHERE g.group_code = 'CCCRN-NIG-0006'
  ORDER BY l.created_at DESC LIMIT 1
`)).rows[0];
await db.end();
if (!fixture) throw new Error("Phase 2C RBAC fixture not found");

const key = () => `phase2c-rbac-${crypto.randomUUID()}`;
const requests = [
  ["GET", `/api/v1/groups/${fixture.group_id}/loans`],
  ["GET", `/api/v1/groups/${fixture.group_id}/loans/${fixture.loan_id}`],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/loan-requests`, { memberId: fixture.member_id, requestedPrincipal: "1000.00", requestedTermMonths: 1 }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/loan-requests/${fixture.request_id}/approve`, { approvedPrincipal: "1000.00", approvedTermMonths: 1 }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/loan-requests/${fixture.request_id}/reject`, { notes: "RBAC test" }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/loan-requests/${fixture.request_id}/cancel`, { reason: "RBAC test" }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/loan-requests/${fixture.request_id}/disburse`, { idempotencyKey: fixture.idempotency_key }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/loans/${fixture.loan_id}/repayments`, { paymentAmount: "1.00", idempotencyKey: key() }],
  ["POST", `/api/v1/groups/${fixture.group_id}/loans/${fixture.loan_id}/default`, { reason: "RBAC test" }],
  ["POST", `/api/v1/groups/${fixture.group_id}/meetings/${fixture.meeting_id}/loans/${fixture.loan_id}/transactions/${fixture.transaction_id}/reverse`, { idempotencyKey: key() }],
];

const results = [];
for (const [method, path, body] of requests) {
  const response = await fetch(`http://localhost:3000${path}`, {
    method,
    headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (response.status !== 403) throw new Error(`${method} ${path}: expected 403, got ${response.status}`);
  results.push({ method, path, status: response.status });
}
console.log(JSON.stringify(results, null, 2));
