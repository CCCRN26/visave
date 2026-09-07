import fs from "node:fs";
import pg from "pg";

for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
  const match = line.match(/^([^#][^=]*)=(.*)$/);
  if (match && !process.env[match[1].trim()]) process.env[match[1].trim()] = match[2].trim().replace(/^"|"$/g, "");
}
const base = "http://localhost:3000";
const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
await db.connect();
let cookie;
const key = name => `phase2c-isolated-${name}-${crypto.randomUUID()}`;
async function api(method, path, body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const json = await response.json().catch(() => ({}));
  if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${response.status}: ${json.error?.message}`);
  return json.data;
}

try {
  const login = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const interrupted = (await db.query(`SELECT g.id group_id,m.id meeting_id FROM vsla_groups g JOIN vsla_meetings m ON m.group_id=g.id WHERE g.group_code LIKE 'PHASE2C-SNAPSHOT-%' AND m.status='OPEN'`)).rows;
  for (const item of interrupted) {
    const transactions = (await db.query(`SELECT t.*,l.id loan_id FROM financial_transactions t LEFT JOIN loans l ON l.disbursement_financial_transaction_id=t.id WHERE t.meeting_id=$1 AND t.reversal_of_transaction_id IS NULL AND NOT EXISTS(SELECT 1 FROM financial_transactions r WHERE r.reversal_of_transaction_id=t.id) ORDER BY t.created_at DESC`, [item.meeting_id])).rows;
    for (const transaction of transactions) {
      const path = transaction.transaction_type === "LOAN_DISBURSEMENT" ? `/api/v1/groups/${item.group_id}/meetings/${item.meeting_id}/loans/${transaction.loan_id}/transactions/${transaction.id}/reverse` : `/api/v1/groups/${item.group_id}/meetings/${item.meeting_id}/transactions/${transaction.id}/reverse`;
      await api("POST", path, { idempotencyKey: key("recover") }, 201);
    }
    await api("POST", `/api/v1/groups/${item.group_id}/meetings/${item.meeting_id}/cancel`, { reason: "Completed isolated Phase 2C acceptance cleanup" });
  }
  const suffix = crypto.randomUUID().slice(0, 8).toUpperCase();
  const source = (await db.query("SELECT * FROM vsla_groups WHERE group_code='CCCRN-NIG-0006'")).rows[0];
  const admin = (await db.query("SELECT id FROM users WHERE email=$1", [process.env.SEED_ADMIN_EMAIL.toLowerCase()])).rows[0];
  const group = (await db.query(`INSERT INTO vsla_groups(organization_id,project_id,group_code,name,state_id,lga_id,community_id,date_formed,meeting_location,group_type,status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,CURRENT_DATE-1,'Isolated acceptance fixture','SUPERVISED','ACTIVE',$8) RETURNING *`, [source.organization_id, source.project_id, `PHASE2C-SNAPSHOT-${suffix}`, "Phase 2C Snapshot Acceptance", source.state_id, source.lga_id, source.community_id, admin.id])).rows[0];
  const constitutionV1 = (await db.query(`INSERT INTO group_constitutions(organization_id,group_id,version_number,status,share_value,min_shares_per_meeting,max_shares_per_meeting,social_fund_contribution,loan_max_multiple,loan_service_charge_rate,loan_max_term_months,meeting_frequency,approved_at,approved_by,created_by) VALUES($1,$2,1,'APPROVED',5000,1,5,0,3,10,3,'WEEKLY',now(),$3,$3) RETURNING *`, [group.organization_id, group.id, admin.id])).rows[0];
  const cycle = (await db.query(`INSERT INTO vsla_cycles(organization_id,group_id,constitution_id,cycle_number,start_date,expected_end_date,status,activated_at,created_by) VALUES($1,$2,$3,1,CURRENT_DATE-1,CURRENT_DATE+INTERVAL '6 months','ACTIVE',now(),$4) RETURNING *`, [group.organization_id, group.id, constitutionV1.id, admin.id])).rows[0];
  const members = [];
  for (let number = 1; number <= 2; number++) members.push((await db.query(`INSERT INTO group_members(organization_id,group_id,member_number,member_code,first_name,last_name,date_joined,status,created_by) VALUES($1,$2,$3,$4,$5,'Fixture',CURRENT_DATE-1,'ACTIVE',$6) RETURNING *`, [group.organization_id, group.id, number, `${group.group_code}-${number}`, `Member${number}`, admin.id])).rows[0]);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" });
  const meeting = await api("POST", `/api/v1/groups/${group.id}/meetings`, { meetingDate: today }, 201);
  const detail = await api("GET", `/api/v1/groups/${group.id}/meetings/${meeting.id}`);
  await api("PATCH", `/api/v1/groups/${group.id}/meetings/${meeting.id}/attendance`, { updates: detail.attendance.map(row => ({ memberId: row.member_id, status: "PRESENT" })) });
  const savingOne = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/savings`, { memberId: members[0].id, numberOfShares: 1, idempotencyKey: key("saving-one") }, 201);
  const savingThree = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/savings`, { memberId: members[0].id, numberOfShares: 3, idempotencyKey: key("saving-three") }, 201);
  const liquidity = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/savings`, { memberId: members[1].id, numberOfShares: 5, idempotencyKey: key("liquidity") }, 201);
  const eligibilityBefore = await api("GET", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-eligibility/${members[0].id}`);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/transactions/${savingOne.transaction.id}/reverse`, { idempotencyKey: key("saving-reversal") }, 201);
  const eligibilityAfter = await api("GET", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-eligibility/${members[0].id}`);
  if (eligibilityBefore.net_savings !== "20000.00" || eligibilityBefore.maximum_eligible !== "60000.00" || eligibilityAfter.net_savings !== "15000.00" || eligibilityAfter.maximum_eligible !== "45000.00") throw new Error("Savings reversal eligibility did not recalculate correctly");
  const request = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests`, { memberId: members[0].id, requestedPrincipal: "45000.00", requestedTermMonths: 3 }, 201);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests`, { memberId: members[0].id, requestedPrincipal: "45001.00", requestedTermMonths: 3 }, 400);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${request.id}/approve`, { approvedPrincipal: "30000.00", approvedTermMonths: 3 }, 201);
  const disbursement = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${request.id}/disburse`, { idempotencyKey: key("snapshot-loan") }, 201);
  const before = (await api("GET", `/api/v1/groups/${group.id}/loans/${disbursement.loan.id}`)).loan;
  await db.query("UPDATE group_constitutions SET status='SUPERSEDED',updated_at=now() WHERE id=$1", [constitutionV1.id]);
  const constitutionV2 = (await db.query(`INSERT INTO group_constitutions(organization_id,group_id,version_number,status,share_value,min_shares_per_meeting,max_shares_per_meeting,social_fund_contribution,loan_max_multiple,loan_service_charge_rate,loan_max_term_months,meeting_frequency,approved_at,approved_by,created_by) VALUES($1,$2,2,'APPROVED',5000,1,5,0,3,5,3,'WEEKLY',now(),$3,$3) RETURNING *`, [group.organization_id, group.id, admin.id])).rows[0];
  await db.query("UPDATE vsla_cycles SET constitution_id=$2,updated_at=now() WHERE id=$1", [cycle.id, constitutionV2.id]);
  const after = (await api("GET", `/api/v1/groups/${group.id}/loans/${disbursement.loan.id}`)).loan;
  for (const field of ["constitution_id", "service_charge_rate", "term_months", "service_charge_total_due", "total_contractual_due"]) if (String(before[field]) !== String(after[field])) throw new Error(`Loan snapshot changed: ${field}`);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loans/${disbursement.loan.id}/transactions/${disbursement.transaction.id}/reverse`, { idempotencyKey: key("cleanup-loan") }, 201);
  for (const transaction of [savingThree.transaction, liquidity.transaction]) await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/transactions/${transaction.id}/reverse`, { idempotencyKey: key("cleanup-savings") }, 201);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/cancel`, { reason: "Completed isolated Phase 2C acceptance cleanup" });
  console.log(JSON.stringify({ group: group.group_code, savingsReversal: { before: eligibilityBefore, after: eligibilityAfter, acceptedRequest: request.id, rejectedAmount: "45001.00" }, constitutionSnapshot: { oldConstitutionId: constitutionV1.id, newConstitutionId: constitutionV2.id, newRate: constitutionV2.loan_service_charge_rate, loanBefore: before, loanAfter: after } }, null, 2));
} finally {
  await db.end().catch(() => {});
}
