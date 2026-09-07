import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { assembleMemberStatement, canAccessMemberStatement } from "../src/modules/reports/member-statement.service.js";
import { createMemberStatementWorkbook } from "../src/modules/reports/member-statement-excel.js";

const user = { id: "self", first_name: "Amina", last_name: "Member", organization_id: "org", roles: [], permissions: [] };
const raw = { metadata: { group_id: "group-a", group_name: "Group A", group_code: "A-01", cycle_id: "cycle-1", cycle_number: 1, cycle_status: "CLOSED", member_id: "member-a", linked_user_id: "self", member_code: "M-01", member_name: "Amina Member", participation_start_date: "2026-01-15", participation_end_date: null }, attendance: [{ meeting_id: "m3", meeting_number: 3, meeting_date: "2026-01-15", meeting_status: "CLOSED", attendance_status: "PRESENT" }], savingsTransactions: [{ meeting_id: "m3", meeting_number: 3, meeting_date: "2026-01-15", effective_date: "2026-01-15", transaction_kind: "PURCHASE", shares: 10, amount: "10000" }, { meeting_id: "m3", meeting_number: 3, meeting_date: "2026-01-15", effective_date: "2026-01-15", transaction_kind: "REVERSAL", shares: 10, amount: "10000" }, { meeting_id: "m3", meeting_number: 3, meeting_date: "2026-01-15", effective_date: "2026-01-15", transaction_kind: "PURCHASE", shares: 8, amount: "8000" }], socialFundTransactions: [{ meeting_id: "m3", meeting_number: 3, meeting_date: "2026-01-15", effective_date: "2026-01-15", transaction_kind: "CONTRIBUTION", amount: "1000" }, { meeting_id: "m3", meeting_number: 3, meeting_date: "2026-01-15", effective_date: "2026-01-15", transaction_kind: "REVERSAL", amount: "1000" }, { meeting_id: "m3", meeting_number: 3, meeting_date: "2026-01-15", effective_date: "2026-01-15", transaction_kind: "CONTRIBUTION", amount: "500" }], fineTransactions: [], loans: [], loanTransactions: [], shareout: { shareout: { status: "COMPLETED" }, entitlements: [{ member_id: "member-a", net_savings: "8000", final_entitlement: "8600", net_paid: "8600", payout_history: [] }] } };

test("member statement preserves historical participant isolation and reversals", () => {
  const report = assembleMemberStatement(raw, { user, generatedAt: "2026-02-01T00:00:00.000Z" });
  assert.equal(report.attendance.rows.length, 1, "mid-cycle joiner is not made absent before participation");
  assert.equal(report.savings.total, "8000.00");
  assert.equal(report.socialFund.total, "500.00");
  assert.equal(report.shareout.paid, "8600");
  assert.equal(report.socialFund.rows.length, 1, "carry-forward has no member transaction row");
  assert.deepEqual(createMemberStatementWorkbook(report).worksheets.map((sheet) => sheet.name), ["Member Summary", "Attendance", "Savings", "Social Fund", "Fines", "Loans", "Loan Transactions", "Share-out"]);
});

test("ordinary members can access only their own participating statement", () => {
  const actor = { linked_member_id: "member-a", cycle_membership_id: "cm", member_status: "ACTIVE" };
  assert.equal(canAccessMemberStatement(user, actor, raw.metadata), true);
  assert.equal(canAccessMemberStatement({ ...user, id: "other" }, actor, raw.metadata), false);
});

test("web and Excel routes consume the same canonical service and validate all route ids", () => {
  const source = fs.readFileSync("src/modules/reports/member-statement.repository.js", "utf8");
  const page = fs.readFileSync("src/app/(protected)/groups/[id]/reports/cycles/[cycleId]/members/[memberId]/page.js", "utf8");
  const api = fs.readFileSync("src/app/api/v1/groups/[id]/cycles/[cycleId]/members/[memberId]/reports/excel/route.js", "utf8");
  assert.match(source, /g\.id=\$2 AND cy\.id=\$3 AND gm\.id=\$4/);
  assert.match(source, /cm\.participation_start_date<=vm\.meeting_date/);
  const service = fs.readFileSync("src/modules/reports/member-statement.service.js", "utf8");
  assert.match(service, /transactionSign\(row\.transaction_kind, positiveKind\)/);
  assert.match(page, /getMemberStatement/); assert.match(api, /getMemberStatement/); assert.match(api, /buildMemberStatementExcel/);
});
