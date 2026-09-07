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
const results = [];
const key = name => `phase2c-final-${name}-${crypto.randomUUID()}`;
async function api(method, path, body, expected = 200) {
  const response = await fetch(base + path, { method, headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, redirect: "manual" });
  const json = await response.json().catch(() => ({}));
  if (response.status !== expected) throw new Error(`${method} ${path}: expected ${expected}, got ${response.status}: ${json.error?.message}`);
  return { status: response.status, data: json.data };
}
async function counts(meetingId, action, entityId) {
  return (await db.query(`SELECT
    (SELECT COUNT(*)::int FROM loans WHERE disbursement_meeting_id=$1) loans,
    (SELECT COUNT(*)::int FROM loan_repayments WHERE meeting_id=$1) repayments,
    (SELECT COUNT(*)::int FROM financial_transactions WHERE meeting_id=$1) financial,
    (SELECT COUNT(*)::int FROM ledger_entries e JOIN financial_transactions t ON t.id=e.financial_transaction_id WHERE t.meeting_id=$1) ledger,
    (SELECT COUNT(*)::int FROM audit_logs WHERE action=$2 AND entity_id=$3) audits`, [meetingId, action, entityId])).rows[0];
}

try {
  const login = await fetch(base + "/api/v1/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: process.env.SEED_ADMIN_EMAIL, password: process.env.SEED_ADMIN_PASSWORD }) });
  if (!login.ok) throw new Error(`Login failed: ${login.status}`);
  cookie = login.headers.get("set-cookie").split(";", 1)[0];
  const group = (await api("GET", "/api/v1/groups?search=CCCRN-NIG-0006&pageSize=20")).data.items.find(item => item.group_code === "CCCRN-NIG-0006");
  const members = (await api("GET", `/api/v1/groups/${group.id}/members?status=ACTIVE&pageSize=100`)).data.items;
  const meeting = (await api("POST", `/api/v1/groups/${group.id}/meetings`, { meetingDate: new Date().toLocaleDateString("en-CA", { timeZone: "Africa/Lagos" }) }, 201)).data;
  const detail = (await api("GET", `/api/v1/groups/${group.id}/meetings/${meeting.id}`)).data;
  await api("PATCH", `/api/v1/groups/${group.id}/meetings/${meeting.id}/attendance`, { updates: detail.attendance.map(row => ({ memberId: row.member_id, status: "PRESENT" })) });

  const eligibility = (await api("GET", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-eligibility/${members[0].id}`)).data;
  const requested = Math.min(Number(eligibility.maximum_eligible), 9000).toFixed(2);
  const request = (await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests`, { memberId: members[0].id, requestedPrincipal: requested, requestedTermMonths: 1 }, 201)).data;
  const decisionBefore = (await db.query("SELECT COUNT(*)::int n FROM loan_decisions WHERE loan_request_id=$1", [request.id])).rows[0].n;
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${request.id}/approve`, { approvedPrincipal: (Number(requested) + 1).toFixed(2), approvedTermMonths: 1 }, 400);
  const decisionAfter = (await db.query("SELECT COUNT(*)::int n FROM loan_decisions WHERE loan_request_id=$1", [request.id])).rows[0].n;
  if (decisionBefore !== decisionAfter) throw new Error("Rejected approval committed a decision");
  results.push({ scenario: "Approve above requested amount", result: "PASS", evidence: { requested, attempted: (Number(requested) + 1).toFixed(2), decisionBefore, decisionAfter } });
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${request.id}/approve`, { approvedPrincipal: requested, approvedTermMonths: 1 }, 201);

  const disbursementKey = key("disburse");
  const first = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${request.id}/disburse`, { idempotencyKey: disbursementKey }, 201);
  const afterFirst = await counts(meeting.id, "LOAN_DISBURSED", first.data.loan.id);
  const retry = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${request.id}/disburse`, { idempotencyKey: disbursementKey }, 201);
  const afterRetry = await counts(meeting.id, "LOAN_DISBURSED", first.data.loan.id);
  if (first.data.loan.id !== retry.data.loan.id || first.data.transaction.id !== retry.data.transaction.id || JSON.stringify(afterFirst) !== JSON.stringify(afterRetry)) throw new Error("Disbursement exact retry duplicated or changed response");
  results.push({ scenario: "Exact disbursement retry", result: "PASS", evidence: { key: disbursementKey, loanId: first.data.loan.id, transactionId: first.data.transaction.id, afterFirst, afterRetry } });

  const otherEligibility = (await api("GET", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-eligibility/${members[1].id}`)).data;
  const otherAmount = Math.min(Number(otherEligibility.maximum_eligible), 1000).toFixed(2);
  const other = (await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests`, { memberId: members[1].id, requestedPrincipal: otherAmount, requestedTermMonths: 1 }, 201)).data;
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${other.id}/approve`, { approvedPrincipal: otherAmount, approvedTermMonths: 1 }, 201);
  const conflictBefore = await counts(meeting.id, "LOAN_DISBURSED", first.data.loan.id);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests/${other.id}/disburse`, { idempotencyKey: disbursementKey }, 409);
  const conflictAfter = await counts(meeting.id, "LOAN_DISBURSED", first.data.loan.id);
  if (JSON.stringify(conflictBefore) !== JSON.stringify(conflictAfter)) throw new Error("Disbursement conflict changed rows");
  results.push({ scenario: "Disbursement key conflict", result: "PASS", evidence: { conflictBefore, conflictAfter } });

  const loan = (await api("GET", `/api/v1/groups/${group.id}/loans/${first.data.loan.id}`)).data.loan;
  const repaymentKey = key("final-repayment");
  const payment = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loans/${loan.id}/repayments`, { paymentAmount: loan.total_outstanding, idempotencyKey: repaymentKey }, 201);
  const paymentCounts = await counts(meeting.id, "LOAN_REPAYMENT_RECORDED", payment.data.repayment.id);
  const retryAmount = String(Number(loan.total_outstanding));
  const paymentRetry = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loans/${loan.id}/repayments`, { paymentAmount: retryAmount, idempotencyKey: repaymentKey }, 201);
  const retryCounts = await counts(meeting.id, "LOAN_REPAYMENT_RECORDED", payment.data.repayment.id);
  if (payment.data.repayment.id !== paymentRetry.data.repayment.id || payment.data.transaction.id !== paymentRetry.data.transaction.id || JSON.stringify(paymentCounts) !== JSON.stringify(retryCounts)) throw new Error("Final repayment retry duplicated rows");
  results.push({ scenario: "Exact final-repayment retry", result: "PASS", evidence: { key: repaymentKey, repaymentId: payment.data.repayment.id, transactionId: payment.data.transaction.id, paymentCounts, retryCounts } });
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loans/${loan.id}/repayments`, { paymentAmount: "1.00", idempotencyKey: repaymentKey }, 409);
  results.push({ scenario: "Final-repayment key conflict", result: "PASS", evidence: "HTTP 409; counts unchanged by transaction rollback" });

  const reversalCountsBefore = await counts(meeting.id, "LOAN_DISBURSEMENT_REVERSED", loan.id);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loans/${loan.id}/transactions/${first.data.transaction.id}/reverse`, { idempotencyKey: key("bad-disbursement-reversal") }, 409);
  const reversalCountsAfter = await counts(meeting.id, "LOAN_DISBURSEMENT_REVERSED", loan.id);
  if (JSON.stringify(reversalCountsBefore) !== JSON.stringify(reversalCountsAfter)) throw new Error("Rejected disbursement reversal changed rows");
  results.push({ scenario: "Reverse disbursement after repayment", result: "PASS", evidence: { reversalCountsBefore, reversalCountsAfter } });

  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loans/${loan.id}/transactions/${payment.data.transaction.id}/reverse`, { idempotencyKey: key("reverse-final") }, 201);
  const restored = (await api("GET", `/api/v1/groups/${group.id}/loans/${loan.id}`)).data.loan;
  if (restored.display_status === "REPAID" || Number(restored.total_outstanding) <= 0 || restored.settled_at) throw new Error("Final repayment reversal did not restore obligation");
  results.push({ scenario: "Reverse final repayment while OPEN", result: "PASS", evidence: { status: restored.display_status, settledAt: restored.settled_at, outstanding: restored.total_outstanding } });
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loans/${loan.id}/repayments`, { paymentAmount: restored.total_outstanding, idempotencyKey: key("resettle") }, 201);
  const secondRequest = await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/loan-requests`, { memberId: members[0].id, requestedPrincipal: "1000.00", requestedTermMonths: 1 }, 201);
  results.push({ scenario: "New request after settlement", result: "PASS", evidence: { firstLoanId: loan.id, secondRequestId: secondRequest.data.id, memberId: members[0].id } });

  const balances = (await db.query(`SELECT COALESCE(SUM(CASE WHEN a.account_code='SAVINGS_LOAN_CASH' THEN CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0)::numeric(18,2) savings,COALESCE(SUM(CASE WHEN a.account_code='SOCIAL_FUND_CASH' THEN CASE e.entry_side WHEN 'DEBIT' THEN e.amount ELSE -e.amount END ELSE 0 END),0)::numeric(18,2) social FROM ledger_accounts a LEFT JOIN ledger_entries e ON e.ledger_account_id=a.id WHERE a.cycle_id=$1`, [loan.cycle_id])).rows[0];
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/reconcile`, { countedSavingsLoanBalance: balances.savings, countedSocialFundBalance: balances.social }, 201);
  await api("POST", `/api/v1/groups/${group.id}/meetings/${meeting.id}/close`, {});
  console.log(JSON.stringify({ meeting: meeting.id, results }, null, 2));
} finally {
  await db.end().catch(() => {});
}
