import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ExcelJS from "exceljs";
import { canAccessCycleReports } from "@/modules/reports/cycle-report.service";
import { assembleMeetingReport } from "@/modules/reports/meeting-report.service";
import { buildMeetingReportExcel, meetingReportFilename } from "@/modules/reports/meeting-report-excel";

const user = { id: "user-1", organization_id: "org-1", first_name: "Report", last_name: "Admin", email: "report@example.org", roles: ["PROJECT_ADMIN"], permissions: ["report.view", "report.export"] };
const participant = (id, code, name, status = "PRESENT") => ({ member_id: id, member_code: code, member_name: name, member_number: Number(code.slice(-1)), member_status: "ACTIVE", participation_start_date: "2026-01-01", participation_end_date: null, attendance_status: status, attendance_notes: null, recorded_at: "2026-01-05T09:00:00.000Z", recorded_by_name: "Record Keeper" });
const transaction = (id, kind, amount, member = "amina", original = null) => ({ id, financial_transaction_id: `ft-${id}`, meeting_id: "m1", member_id: member, transaction_kind: kind, amount, shares: Number(amount) / 1000, share_value: "1000.00", original_savings_transaction_id: original, original_social_fund_transaction_id: original, reference_code: `REF-${id}`, effective_date: "2026-01-05", created_at: "2026-01-05T10:00:00.000Z", member_code: member === "amina" ? "M001" : "M002", member_name: member === "amina" ? "Amina" : "Musa" });

function rawReport() {
  return {
    metadata: { group_id: "g1", group_code: "CCCRN-NIG-MNA-0001", group_name: "Unity Group", operation_mode: "PROGRAM_ASSISTED", state_name: "Niger", lga_name: "Chanchaga", community_name: "Minna", cycle_id: "c1", cycle_number: 1, cycle_status: "CLOSED", meeting_id: "m1", meeting_number: 1, meeting_code: "M-1", meeting_date: "2026-01-05", meeting_status: "CLOSED", opened_at: "2026-01-05T08:00:00.000Z", opened_by_name: "Record Keeper", closed_at: "2026-01-05T12:00:00.000Z", closed_by_name: "Chairperson", cancelled_at: null, cancelled_by_name: null, cancellation_reason: null },
    officers: [{ member_id: "amina", position_code: "CHAIRPERSON", member_code: "M001", member_name: "Amina", status: "ACTIVE" }],
    participants: [participant("amina", "M001", "Amina"), participant("musa", "M002", "Musa", "LATE"), participant("grace", "M003", "Grace", "EXCUSED")],
    savingsTransactions: [transaction("s1", "PURCHASE", "10000.00"), transaction("s2", "REVERSAL", "10000.00", "amina", "s1"), transaction("s3", "PURCHASE", "8000.00")],
    socialFundTransactions: [transaction("sf1", "CONTRIBUTION", "1000.00"), transaction("sf2", "REVERSAL", "1000.00", "amina", "sf1"), transaction("sf3", "CONTRIBUTION", "500.00")],
    fineTransactions: [{ id: "f1", financial_transaction_id: "ft-f1", meeting_id: "m1", member_id: "musa", transaction_kind: "FINE", amount: "100.00", reason: "Late", original_fine_transaction_id: null, fine_name: "Late arrival", reference_code: "REF-F1", effective_date: "2026-01-05", member_code: "M002", member_name: "Musa" }],
    loanRequests: [{ id: "request-1", request_code: "LR-1", member_id: "musa", member_code: "M002", borrower_name: "Musa", purpose: "Trade", requested_principal: "5000.00", requested_term_months: 2, requested_at: "2026-01-05T09:30:00.000Z", request_meeting_id: "m1", requested_by_name: "Record Keeper", decision: "APPROVED", approved_principal: "5000.00", approved_term_months: 2, decision_meeting_id: "m1", decided_at: "2026-01-05T09:45:00.000Z", decided_by_name: "Chairperson", cancelled_at: null, disbursement_meeting_id: "m1", report_status: "DISBURSED" }],
    loans: [{ id: "loan-1", loan_code: "LN-1", member_id: "musa", member_code: "M002", borrower_name: "Musa", purpose: "Trade", principal_disbursed: "5000.00", service_charge_rate: "10.0000", term_months: 2, service_charge_total_due: "500.00", total_contractual_due: "5500.00", disbursement_date: "2026-01-05", due_date: "2026-03-05", disbursed_by_name: "Record Keeper", status_at_meeting: "REPAID" }],
    repayments: [{ id: "rp1", financial_transaction_id: "ft-rp1", transaction_kind: "PAYMENT", payment_amount: "5500.00", principal_component: "5000.00", service_charge_component: "500.00", original_loan_repayment_id: null, created_at: "2026-01-05T11:00:00.000Z", reference_code: "REF-RP1", effective_date: "2026-01-05", loan_id: "loan-1", loan_code: "LN-1", member_code: "M002", borrower_name: "Musa", recorded_by_name: "Record Keeper" }],
    reconciliation: { id: "rec1", status: "BALANCED", expected_savings_loan_balance: "8100.00", counted_savings_loan_balance: "8100.00", savings_loan_difference: "0.00", expected_social_fund_balance: "500.00", counted_social_fund_balance: "500.00", social_fund_difference: "0.00", notes: "Balanced", created_at: "2026-01-05T11:30:00.000Z", reconciled_by_name: "Chairperson", signature_recorded: true },
    totals: { net_savings: "8000.00", social_fund_contributions: "500.00", fines_assessed: "100.00", fines_collected: "100.00", loan_requests: 1, loans_approved: 1, loans_rejected: 0, loans_disbursed: 1, loan_principal_disbursed: "5000.00", loan_repayments: "5500.00", principal_repaid: "5000.00", service_charge_collected: "500.00" },
  };
}

const build = (raw = rawReport()) => assembleMeetingReport(raw, { user, generatedAt: "2026-01-05T13:00:00.000Z" });

test("closed meeting preserves its attendance snapshot and excludes later-cycle members", () => {
  const report = build();
  assert.deepEqual(report.attendance.rows.map((row) => row.memberName), ["Amina", "Musa", "Grace"]);
  assert.ok(!report.attendance.rows.some((row) => row.memberName === "John"));
  assert.equal(report.metadata.reportStatus, "FINAL");
});

test("mid-cycle participant appears only from the effective meeting snapshot", () => {
  const meeting2 = rawReport();
  meeting2.metadata.meeting_id = "m2";
  meeting2.metadata.meeting_number = 2;
  meeting2.participants = [participant("amina", "M001", "Amina")];
  meeting2.savingsTransactions = [];
  meeting2.socialFundTransactions = [];
  meeting2.fineTransactions = [];
  meeting2.loanRequests = [];
  meeting2.loans = [];
  meeting2.repayments = [];
  meeting2.totals = { net_savings: "0.00", social_fund_contributions: "0.00", fines_assessed: "0.00", fines_collected: "0.00", loan_requests: 0, loans_approved: 0, loans_rejected: 0, loans_disbursed: 0, loan_principal_disbursed: "0.00", loan_repayments: "0.00", principal_repaid: "0.00", service_charge_collected: "0.00" };
  const meeting3 = structuredClone(meeting2);
  meeting3.metadata.meeting_id = "m3";
  meeting3.metadata.meeting_number = 3;
  meeting3.participants.push(participant("samuel", "M004", "Samuel"));
  assert.deepEqual(build(meeting2).attendance.rows.map((row) => row.memberName), ["Amina"]);
  assert.deepEqual(build(meeting3).attendance.rows.map((row) => row.memberName), ["Amina", "Samuel"]);
});

test("meeting savings and Social Fund reversals net explicitly", () => {
  const report = build();
  assert.equal(report.savings.total, "8000.00");
  assert.equal(report.savings.rows[0].netSavings, "8000.00");
  assert.equal(report.socialFund.total, "500.00");
  assert.equal(report.socialFund.rows[0].netContribution, "500.00");
  assert.equal(report.integrity.status, "PASSED");
});

test("loan request, disbursement, and repayment totals are meeting-specific", () => {
  const report = build();
  assert.equal(report.meetingSummary.loanRequests, 1);
  assert.equal(report.meetingSummary.loansApproved, 1);
  assert.equal(report.loans[0].principal, "5000.00");
  assert.equal(report.loanRepayments.totals.repayments, "5500.00");
  assert.equal(report.loanRepayments.totals.serviceChargeCollected, "500.00");
});

test("closed reconciliation exposes balanced cash and signature without storage metadata", () => {
  const report = build();
  assert.equal(report.reconciliation.status, "BALANCED");
  assert.equal(report.reconciliation.variance, "0.00");
  assert.equal(report.reconciliation.signatureRecorded, true);
  assert.equal("storageKey" in report.reconciliation, false);
});

test("open meeting with no activity remains a valid in-progress report", () => {
  const raw = rawReport();
  raw.metadata.meeting_status = "OPEN";
  raw.metadata.closed_at = null;
  raw.metadata.closed_by_name = null;
  raw.savingsTransactions = [];
  raw.socialFundTransactions = [];
  raw.fineTransactions = [];
  raw.loanRequests = [];
  raw.loans = [];
  raw.repayments = [];
  raw.reconciliation = null;
  raw.totals = { net_savings: "0.00", social_fund_contributions: "0.00", fines_assessed: "0.00", fines_collected: "0.00", loan_requests: 0, loans_approved: 0, loans_rejected: 0, loans_disbursed: 0, loan_principal_disbursed: "0.00", loan_repayments: "0.00", principal_repaid: "0.00", service_charge_collected: "0.00" };
  const report = build(raw);
  assert.equal(report.metadata.reportStatus, "IN PROGRESS");
  assert.equal(report.reconciliation.status, "NOT YET RECONCILED");
  assert.equal(report.loans.length, 0);
});

test("report authorization is inherited from Reporting V1", () => {
  assert.equal(canAccessCycleReports(user, { operation_mode: "PROGRAM_ASSISTED", has_program_scope: true, cycle_status: "ACTIVE" }, "export"), true);
  assert.equal(canAccessCycleReports({ roles: ["VSLA_MEMBER"], permissions: [] }, { operation_mode: "MEMBER_MANAGED", cycle_status: "ACTIVE", linked_member_id: "m1", cycle_membership_id: "cm1", member_status: "ACTIVE", officer_position: null }), false);
});

test("Excel uses the canonical report totals and the eight required sheets", async () => {
  const report = build();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(await buildMeetingReportExcel(report));
  assert.deepEqual(workbook.worksheets.map((sheet) => sheet.name), ["Meeting Summary", "Attendance", "Savings", "Social Fund", "Fines", "Loan Requests", "Loans & Repayments", "Reconciliation"]);
  let exportedSavings;
  workbook.getWorksheet("Meeting Summary").eachRow((row) => { if (row.getCell(1).value === "Net Savings") exportedSavings = row.getCell(2).value; });
  assert.equal(exportedSavings, Number(report.meetingSummary.netSavings));
  assert.equal(workbook.getWorksheet("Attendance").getCell("B6").value, report.attendance.rows[0].memberName);
  assert.equal(meetingReportFilename(report), "Visave_CCCRN-NIG-MNA-0001_Cycle-1_Meeting-01_FINAL.xlsx");
});

test("repository, page, and export route enforce all three resource identifiers", async () => {
  const repository = await readFile(new URL("../src/modules/reports/meeting-report.repository.js", import.meta.url), "utf8");
  const service = await readFile(new URL("../src/modules/reports/meeting-report.service.js", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/(protected)/groups/[id]/reports/cycles/[cycleId]/meetings/[meetingId]/page.js", import.meta.url), "utf8");
  const route = await readFile(new URL("../src/app/api/v1/groups/[id]/cycles/[cycleId]/meetings/[meetingId]/reports/excel/route.js", import.meta.url), "utf8");
  assert.match(repository, /m\.group_id=\$2 AND m\.cycle_id=\$3/);
  assert.match(repository, /cm\.participation_start_date<=vm\.meeting_date/);
  assert.match(repository, /rp\.meeting_id=\$3/);
  assert.match(repository, /ORDER BY mr\.created_at DESC,mr\.id DESC LIMIT 1/);
  assert.match(service, /assertCycleReportAccess/);
  assert.match(service, /REPEATABLE READ READ ONLY/);
  assert.match(page, /MeetingReportView report=\{report\}/);
  assert.match(route, /getMeetingReport\(user, id, cycleId, meetingId, "export"\)/);
});
