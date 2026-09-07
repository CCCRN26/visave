import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { assembleCycleReport, canAccessCycleReports } from "@/modules/reports/cycle-report.service";
import { buildCycleReportExcel, cycleReportFilename } from "@/modules/reports/cycle-report-excel";

const user = { id: "user-1", organization_id: "org-1", first_name: "Report", last_name: "Admin", email: "report@example.org", roles: ["PROJECT_ADMIN"], permissions: ["report.view"] };
const participant = (id, code, name, start = "2026-01-01") => ({ member_id: id, member_code: code, member_name: name, member_number: Number(code.slice(-1)), member_status: "ACTIVE", participation_start_date: start, participation_end_date: null });
const transaction = (id, kind, amount, member = "amina", meeting = "m1", original = null) => ({ id, financial_transaction_id: `ft-${id}`, meeting_id: meeting, member_id: member, transaction_kind: kind, amount, shares: Number(amount) / 1000, share_value: "1000.00", original_savings_transaction_id: original, original_social_fund_transaction_id: original, reference_code: `REF-${id}`, effective_date: "2026-01-05", created_at: "2026-01-05T10:00:00.000Z" });

function rawReport() {
  return {
    metadata: { group_id: "g1", group_code: "CCCRN-NIG-MNA-0001", group_name: "Unity Group", operation_mode: "PROGRAM_ASSISTED", state_name: "Niger", lga_name: "Chanchaga", community_name: "Minna", cycle_id: "c1", cycle_number: 1, cycle_status: "CLOSED", start_date: "2026-01-01", expected_end_date: "2026-06-30", expected_shareout_date: "2026-06-30", closed_at: "2026-07-01T08:00:00.000Z", cycle_closed_by_name: "Report Admin" },
    participants: [participant("amina", "M001", "Amina"), participant("musa", "M002", "Musa"), participant("grace", "M003", "Grace")],
    officers: [{ member_id: "amina", position_code: "CHAIRPERSON", member_code: "M001", member_name: "Amina", status: "ENDED" }],
    meetings: [{ id: "m1", meeting_number: 1, meeting_code: "M-1", meeting_date: "2026-01-05", status: "CLOSED", closed_at: "2026-01-05T12:00:00.000Z" }],
    attendance: [
      { meeting_id: "m1", member_id: "amina", attendance_status: "PRESENT" },
      { meeting_id: "m1", member_id: "musa", attendance_status: "LATE" },
      { meeting_id: "m1", member_id: "grace", attendance_status: "EXCUSED" },
    ],
    savingsTransactions: [transaction("s1", "PURCHASE", "10000.00"), transaction("s2", "REVERSAL", "10000.00", "amina", "m1", "s1"), transaction("s3", "PURCHASE", "8000.00")],
    socialFundTransactions: [transaction("sf1", "CONTRIBUTION", "1000.00"), transaction("sf2", "REVERSAL", "1000.00", "amina", "m1", "sf1"), transaction("sf3", "CONTRIBUTION", "500.00")],
    fineTransactions: [{ id: "f1", financial_transaction_id: "ft-f1", meeting_id: "m1", member_id: "musa", fine_rule_id: "rule-1", transaction_kind: "FINE", amount: "100.00", reason: "Late", original_fine_transaction_id: null, fine_name: "Late arrival", reference_code: "REF-F1", effective_date: "2026-01-05", created_at: "2026-01-05T10:00:00.000Z", meeting_number: 1, member_code: "M002", member_name: "Musa" }],
    loans: [{ id: "loan-1", loan_code: "LN-1", member_id: "musa", member_code: "M002", borrower_name: "Musa", purpose: "Trade", requested_at: "2026-02-01T10:00:00.000Z", requested_principal: "5000.00", approved_principal: "5000.00", disbursement_date: "2026-02-05", principal_disbursed: "5000.00", service_charge_rate: "10.0000", service_charge_total_due: "500.00", total_contractual_due: "5500.00", due_date: "2026-04-05", settled_at: "2026-03-05T10:00:00.000Z", voided_at: null, defaulted_at: null, total_repaid: "5500.00", principal_repaid: "5000.00", service_charge_collected: "500.00", status: "REPAID" }],
    loanTransactions: [
      { id: "lt1", reference_code: "REF-L1", transaction_type: "LOAN_DISBURSEMENT", effective_date: "2026-02-05", meeting_number: 1, loan_id: "loan-1", loan_code: "LN-1", member_code: "M002", borrower_name: "Musa", amount: "5000.00", principal_component: "5000.00", service_charge_component: "0.00", is_reversal: false, reversal_of_transaction_id: null },
      { id: "lt2", reference_code: "REF-L2", transaction_type: "LOAN_REPAYMENT", effective_date: "2026-03-05", meeting_number: 1, loan_id: "loan-1", loan_code: "LN-1", member_code: "M002", borrower_name: "Musa", amount: "5500.00", principal_component: "5000.00", service_charge_component: "500.00", is_reversal: false, reversal_of_transaction_id: null },
    ],
    cashbook: [],
    accountBalances: [{ account_code: "SAVINGS_LOAN_CASH", balance: "0.00" }, { account_code: "SOCIAL_FUND_CASH", balance: "0.00" }, { account_code: "LOANS_RECEIVABLE", balance: "0.00" }, { account_code: "SHAREOUT_PAYABLE", balance: "0.00" }],
    socialFundTransfers: [{ id: "in", direction: "CARRY_IN", amount: "20000.00", source_cycle_id: "c0", target_cycle_id: "c1" }, { id: "out", direction: "CARRY_OUT", amount: "20500.00", source_cycle_id: "c1", target_cycle_id: "c2" }],
    reconciliations: [{ meeting_id: "m1", status: "BALANCED", created_at: "2026-06-30T12:00:00.000Z", signature_recorded: true }],
    shareout: { shareout: { id: "share-1", status: "COMPLETED", total_net_shares: "8", total_net_savings: "8000.00", fine_income: "100.00", service_charge_income: "500.00", distributable_fund: "8600.00", prepared_at: "2026-06-30T09:00:00.000Z", approved_at: "2026-06-30T10:00:00.000Z", completed_at: "2026-06-30T11:00:00.000Z" }, entitlements: [{ member_id: "amina", member_code_snapshot: "M001", member_name_snapshot: "Amina", net_shares: "8", net_savings: "8000.00", final_entitlement: "8600.00", net_paid: "8600.00" }] },
    nextCycle: { id: "c2", cycle_number: 2, status: "ACTIVE" },
  };
}

const build = (raw = rawReport()) => assembleCycleReport(raw, { user, generatedAt: "2026-07-01T12:00:00.000Z" });

test("closed historical cycle remains isolated to cycle_memberships and selected-cycle transactions", () => {
  const report = build();
  assert.deepEqual(report.attendance.rows.map((row) => row.member_name), ["Amina", "Musa", "Grace"]);
  assert.ok(!report.attendance.rows.some((row) => row.member_name === "John"));
  assert.equal(report.metadata.cycleId, "c1");
  assert.equal(report.metadata.reportStatus, "FINAL");
});

test("mid-cycle participation is blank before effective date and starts at the effective meeting", () => {
  const raw = rawReport();
  raw.metadata.cycle_status = "ACTIVE";
  raw.metadata.closed_at = null;
  raw.shareout = null;
  raw.loans = [];
  raw.loanTransactions = [];
  raw.meetings = [
    { id: "m1", meeting_number: 1, meeting_date: "2026-01-05", status: "CLOSED" },
    { id: "m2", meeting_number: 2, meeting_date: "2026-01-12", status: "CLOSED" },
    { id: "m3", meeting_number: 3, meeting_date: "2026-01-19", status: "OPEN" },
  ];
  raw.participants.push(participant("samuel", "M004", "Samuel", "2026-01-19"));
  raw.attendance.push({ meeting_id: "m3", member_id: "samuel", attendance_status: "PRESENT" });
  raw.savingsTransactions.push(transaction("samuel-s", "PURCHASE", "2000.00", "samuel", "m3"));
  const report = build(raw);
  const attendance = report.attendance.rows.find((row) => row.member_id === "samuel");
  const savings = report.savings.rows.find((row) => row.member_id === "samuel");
  assert.deepEqual([attendance.byMeeting.m1, attendance.byMeeting.m2, attendance.byMeeting.m3], ["—", "—", "P"]);
  assert.deepEqual([savings.byMeeting.m1, savings.byMeeting.m2, savings.byMeeting.m3], [null, null, "2000.00"]);
  assert.equal(report.meetingSummary[0].eligibleParticipants, 3);
  assert.equal(report.meetingSummary[2].eligibleParticipants, 4);
});

test("savings and Social Fund reversals net correctly and carry-forward is not a contribution", () => {
  const report = build();
  assert.equal(report.cycleSummary.netSavings, "8000.00");
  assert.equal(report.cycleSummary.socialFundMemberContributions, "500.00");
  assert.equal(report.socialFund.summary.openingCarryIn, "20000.00");
  assert.equal(report.socialFund.summary.carriedForward, "20500.00");
  assert.equal(report.reconciliation.status, "PASSED");
});

test("Social Fund carry-in of 20,000 plus 5,000 new contributions reports only 5,000 as contributions", () => {
  const raw = rawReport();
  raw.metadata.cycle_status = "ACTIVE";
  raw.metadata.closed_at = null;
  raw.shareout = null;
  raw.loans = [];
  raw.loanTransactions = [];
  raw.socialFundTransactions = [transaction("sf-new", "CONTRIBUTION", "5000.00")];
  raw.socialFundTransfers = [{ id: "carry-in", direction: "CARRY_IN", amount: "20000.00", source_cycle_id: "previous", target_cycle_id: "c1" }];
  raw.accountBalances = [{ account_code: "SOCIAL_FUND_CASH", balance: "25000.00" }, { account_code: "LOANS_RECEIVABLE", balance: "0.00" }];
  const report = build(raw);
  assert.equal(report.socialFund.summary.openingCarryIn, "20000.00");
  assert.equal(report.socialFund.summary.memberContributions, "5000.00");
  assert.equal(report.socialFund.summary.currentClosingBalance, "25000.00");
});

test("loan and completed Share-out totals use authoritative rows and reconcile", () => {
  const report = build();
  assert.equal(report.loans.totals.disbursed, "5000.00");
  assert.equal(report.loans.totals.repaid, "5500.00");
  assert.equal(report.loans.totals.serviceChargeCollected, "500.00");
  assert.equal(report.shareout.summary.distributableFund, "8600.00");
  assert.equal(report.shareout.summary.totalEntitlements, "8600.00");
  assert.equal(report.shareout.summary.totalPaid, "8600.00");
});

test("closed-cycle inconsistency returns REPORT_RECONCILIATION_FAILED", () => {
  const raw = rawReport();
  raw.shareout.shareout.distributable_fund = "8700.00";
  assert.throws(() => build(raw), (error) => error.code === "REPORT_RECONCILIATION_FAILED" && error.details.checks.length === 1);
});

test("report authorization permits scoped reporting actors and denies ordinary members", () => {
  const scoped = { operation_mode: "PROGRAM_ASSISTED", has_program_scope: true, cycle_status: "ACTIVE" };
  assert.equal(canAccessCycleReports(user, scoped), true);
  assert.equal(canAccessCycleReports({ roles: ["FACILITATOR"], permissions: [] }, { operation_mode: "PROGRAM_ASSISTED", cycle_status: "ACTIVE", is_assigned_facilitator: true, is_active_facilitator: true, has_facilitator_scope: true }), true);
  assert.equal(canAccessCycleReports({ roles: ["VSLA_MEMBER"], permissions: [] }, { operation_mode: "MEMBER_MANAGED", cycle_status: "ACTIVE", linked_member_id: "m1", cycle_membership_id: "cm1", member_status: "ACTIVE", officer_position: null }), false);
  assert.equal(canAccessCycleReports({ roles: ["GROUP_OFFICER"], permissions: [] }, { operation_mode: "MEMBER_MANAGED", cycle_status: "ACTIVE", active_cycle_id: "c1", linked_member_id: "m1", cycle_membership_id: "cm1", member_status: "ACTIVE", officer_position: "CHAIRPERSON", isChairperson: true }), true);
});

test("Excel contains all canonical sheets and agrees with the web report summary", async () => {
  const report = build();
  const buffer = await buildCycleReportExcel(report);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Cycle Summary", "Meeting Summary", "Attendance Register", "Savings Ledger", "Social Fund Ledger", "Fines Ledger", "Loan Summary", "Loan Transactions", "Cashbook", "Share-out", "Cycle Closure"]);
  const sheet = workbook.getWorksheet("Cycle Summary");
  let exportedSavings;
  sheet.eachRow((row) => { if (row.getCell(1).value === "Net Savings") exportedSavings = row.getCell(2).value; });
  assert.equal(exportedSavings, Number(report.cycleSummary.netSavings));
  assert.equal(cycleReportFilename(report), "Visave_CCCRN-NIG-MNA-0001_Cycle-1_FINAL.xlsx");
});

test("repository and routes preserve selected-cycle scope without a giant multiplied join", async () => {
  const repository = await readFile(new URL("../src/modules/reports/cycle-report.repository.js", import.meta.url), "utf8");
  const service = await readFile(new URL("../src/modules/reports/cycle-report.service.js", import.meta.url), "utf8");
  const route = await readFile(new URL("../src/app/api/v1/groups/[id]/cycles/[cycleId]/reports/excel/route.js", import.meta.url), "utf8");
  assert.match(repository, /FROM cycle_memberships cm/);
  assert.match(repository, /FROM savings_transactions st/);
  assert.match(repository, /FROM social_fund_transactions sf/);
  assert.match(service, /transaction\.transaction_kind === positiveKind/);
  assert.doesNotMatch(repository, /cycle_memberships[\s\S]{0,400}JOIN savings_transactions/);
  assert.match(service, /REPEATABLE READ READ ONLY/);
  assert.match(route, /requireAuth/);
  assert.match(route, /application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/);
});
