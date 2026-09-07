import { CURRENCY_FORMAT, SECTION_FILL, addHeading, createReportWorkbook, currency, display, safeFilenamePart, writeKeyValueSections, writeTable } from "./report-excel";

function heading(report) {
  return [
    `Visave Meeting Report — ${report.metadata.groupName}`,
    `${report.metadata.groupCode} · Cycle ${report.metadata.cycleNumber} · Meeting ${report.metadata.meetingNumber} · ${report.metadata.reportStatus}`,
    `Generated ${report.metadata.generatedAt} by ${report.metadata.generatedBy.name || report.metadata.generatedBy.email || "Authorized user"}`,
  ];
}

function addTable(workbook, name, report, columns, rows, options = {}) {
  const sheet = workbook.addWorksheet(name);
  addHeading(sheet, heading(report), columns.length);
  sheet.views = [{ state: "frozen", ySplit: 5 }];
  return writeTable(sheet, columns, rows, options);
}

function addSummary(workbook, report) {
  const sheet = workbook.addWorksheet("Meeting Summary");
  addHeading(sheet, heading(report), 2);
  const s = report.meetingSummary;
  writeKeyValueSections(sheet, [
    { title: "Group and Cycle", rows: [
      ["Group Name", report.metadata.groupName], ["Group Code", report.metadata.groupCode], ["State", report.metadata.state],
      ["LGA", report.metadata.lga], ["Community", report.metadata.community], ["Operation Mode", report.metadata.operationMode],
      ["Cycle Number", report.metadata.cycleNumber], ["Cycle Status", report.metadata.cycleStatus],
    ] },
    { title: "Meeting", rows: [
      ["Meeting Number", s.meetingNumber], ["Meeting Date", s.meetingDate], ["Meeting Status", s.meetingStatus],
      ["Report Status", report.metadata.reportStatus], ["Opened At", report.metadata.openedAt], ["Opened By", report.metadata.openedBy],
      ["Closed At", report.metadata.closedAt], ["Closed By", report.metadata.closedBy],
    ] },
    { title: "Attendance", rows: [
      ["Eligible Participants", s.eligibleParticipants], ["Present", s.present], ["Absent", s.absent], ["Late", s.late], ["Excused", s.excused],
    ] },
    { title: "Financial Activity", rows: [
      ["Net Savings", s.netSavings, "currency"], ["Social Fund Contributions", s.socialFundContributions, "currency"],
      ["Fines Assessed", s.finesAssessed, "currency"], ["Fines Collected", s.finesCollected, "currency"],
      ["Loan Requests", s.loanRequests], ["Loans Approved", s.loansApproved], ["Loans Rejected", s.loansRejected],
      ["Loans Disbursed", s.loansDisbursed], ["Loan Principal Disbursed", s.loanPrincipalDisbursed, "currency"],
      ["Loan Repayments", s.loanRepayments, "currency"], ["Principal Repaid", s.principalRepaid, "currency"],
      ["Service Charge Collected", s.serviceChargeCollected, "currency"], ["Reconciliation Status", s.reconciliationStatus],
    ] },
    { title: "Cycle Officers", rows: report.metadata.officers.length
      ? report.metadata.officers.map((officer) => [officer.position_code.replaceAll("_", " "), `${officer.member_name} (${officer.member_code})`])
      : [["Officers", "None recorded"]],
    },
  ]);
  sheet.views = [{ state: "frozen", ySplit: 4 }];
}

function addAttendance(workbook, report) {
  addTable(workbook, "Attendance", report, [
    { key: "memberCode", header: "Member Code", width: 20 },
    { key: "memberName", header: "Member Name", width: 28 },
    { key: "status", header: "Attendance Status", width: 20 },
    { key: "notes", header: "Notes", width: 30, value: (row) => display(row.notes, "") },
    { key: "recordedAt", header: "Recorded At", width: 24, value: (row) => display(row.recordedAt, "") },
    { key: "recordedBy", header: "Recorded By", width: 24, value: (row) => display(row.recordedBy, "") },
  ], report.attendance.rows, { totalRow: { memberCode: "TOTAL ELIGIBLE", memberName: report.attendance.totals.eligible } });
}

function addSavings(workbook, report) {
  addTable(workbook, "Savings", report, [
    { key: "memberCode", header: "Member Code", width: 20 },
    { key: "memberName", header: "Member Name", width: 28 },
    { key: "sharesPurchased", header: "Shares Purchased", width: 18 },
    { key: "sharesReversed", header: "Shares Reversed", width: 18 },
    { key: "purchases", header: "Purchases", width: 16, currency: true, value: (row) => currency(row.purchases) },
    { key: "reversal", header: "Reversals", width: 16, currency: true, value: (row) => currency(row.reversal) },
    { key: "netSavings", header: "Net Savings", width: 17, currency: true, value: (row) => currency(row.netSavings) },
  ], report.savings.rows, { totalRow: { memberCode: "TOTAL", netSavings: currency(report.savings.total) } });
}

function addSocialFund(workbook, report) {
  addTable(workbook, "Social Fund", report, [
    { key: "memberCode", header: "Member Code", width: 20 },
    { key: "memberName", header: "Member Name", width: 28 },
    { key: "contribution", header: "Contribution", width: 17, currency: true, value: (row) => currency(row.contribution) },
    { key: "reversal", header: "Reversal", width: 17, currency: true, value: (row) => currency(row.reversal) },
    { key: "netContribution", header: "Net Contribution", width: 19, currency: true, value: (row) => currency(row.netContribution) },
  ], report.socialFund.rows, { totalRow: { memberCode: "TOTAL", netContribution: currency(report.socialFund.total) } });
}

function addFines(workbook, report) {
  addTable(workbook, "Fines", report, [
    { key: "memberCode", header: "Member Code", width: 20 },
    { key: "memberName", header: "Member Name", width: 28 },
    { key: "reason", header: "Reason", width: 30 },
    { key: "amountAssessed", header: "Assessed", width: 16, currency: true, value: (row) => currency(row.amountAssessed) },
    { key: "amountPaid", header: "Collected", width: 16, currency: true, value: (row) => currency(row.amountPaid) },
    { key: "amountReversed", header: "Reversed", width: 16, currency: true, value: (row) => currency(row.amountReversed) },
    { key: "outstanding", header: "Outstanding", width: 17, currency: true, value: (row) => currency(row.outstanding) },
    { key: "status", header: "Status", width: 15 },
  ], report.fines.rows, { totalRow: {
    memberCode: "TOTAL", amountAssessed: currency(report.fines.totals.assessed), amountPaid: currency(report.fines.totals.collected),
    amountReversed: currency(report.fines.totals.reversed), outstanding: "Not available",
  } });
}

function addLoanRequests(workbook, report) {
  addTable(workbook, "Loan Requests", report, [
    { key: "requestCode", header: "Request", width: 23 },
    { key: "memberCode", header: "Member Code", width: 18 },
    { key: "borrower", header: "Borrower", width: 26 },
    { key: "purpose", header: "Purpose", width: 30 },
    { key: "requestedAmount", header: "Requested", width: 16, currency: true, value: (row) => currency(row.requestedAmount) },
    { key: "approvedAmount", header: "Approved", width: 16, currency: true, value: (row) => currency(row.approvedAmount) },
    { key: "status", header: "Status", width: 15 },
    { key: "requestedBy", header: "Requested By", width: 24 },
    { key: "decidedBy", header: "Decided By", width: 24, value: (row) => display(row.decidedBy, "") },
  ], report.loanRequests);
}

function addLoansAndRepayments(workbook, report) {
  const sheet = workbook.addWorksheet("Loans & Repayments");
  addHeading(sheet, heading(report), 10);
  writeTable(sheet, [
    { key: "loanCode", header: "Loan", width: 21 }, { key: "memberCode", header: "Member Code", width: 18 },
    { key: "borrower", header: "Borrower", width: 25 }, { key: "purpose", header: "Purpose", width: 28 },
    { key: "principal", header: "Principal", width: 16, currency: true, value: (row) => currency(row.principal) },
    { key: "serviceCharge", header: "Service Charge", width: 17, currency: true, value: (row) => currency(row.serviceCharge) },
    { key: "totalDue", header: "Total Due", width: 16, currency: true, value: (row) => currency(row.totalDue) },
    { key: "termMonths", header: "Term (Months)", width: 15 }, { key: "dueDate", header: "Due Date", width: 15 },
    { key: "status", header: "Status", width: 16 },
  ], report.loans, { totalRow: { loanCode: "TOTAL", principal: currency(report.meetingSummary.loanPrincipalDisbursed) } });
  sheet.addRow([]);
  const section = sheet.addRow(["Repayments"]);
  section.font = { bold: true, color: { argb: "FF143D38" } };
  section.fill = SECTION_FILL;
  const repaymentHeader = sheet.rowCount + 1;
  writeTable(sheet, [
    { key: "date", header: "Date", width: 15 }, { key: "loanCode", header: "Loan", width: 21 },
    { key: "memberCode", header: "Member Code", width: 18 }, { key: "borrower", header: "Borrower", width: 25 },
    { key: "transactionType", header: "Type", width: 15 },
    { key: "amountPaid", header: "Amount Paid", width: 16, currency: true, value: (row) => currency(row.amountPaid) },
    { key: "principalComponent", header: "Principal", width: 16, currency: true, value: (row) => currency(row.principalComponent) },
    { key: "serviceChargeComponent", header: "Service Charge", width: 17, currency: true, value: (row) => currency(row.serviceChargeComponent) },
    { key: "remainingBalance", header: "Remaining Balance", width: 19, currency: true, value: (row) => currency(row.remainingBalance) },
    { key: "recordedBy", header: "Recorded By", width: 24 },
  ], report.loanRepayments.rows, { headerRow: repaymentHeader, totalRow: {
    date: "TOTAL", amountPaid: currency(report.loanRepayments.totals.repayments), principalComponent: currency(report.loanRepayments.totals.principalRepaid),
    serviceChargeComponent: currency(report.loanRepayments.totals.serviceChargeCollected), remainingBalance: "Not available",
  } });
  sheet.views = [{ state: "frozen", ySplit: 5 }];
}

function addReconciliation(workbook, report) {
  const sheet = workbook.addWorksheet("Reconciliation");
  addHeading(sheet, heading(report), 2);
  const r = report.reconciliation;
  writeKeyValueSections(sheet, [{ title: "Meeting Reconciliation", rows: r.available ? [
    ["Expected Cash", r.expectedCash, "currency"], ["Actual Cash", r.actualCash, "currency"], ["Variance", r.variance, "currency"], ["Status", r.status],
    ["Savings/Loan Expected", r.savingsLoanFund.expected, "currency"], ["Savings/Loan Actual", r.savingsLoanFund.actual, "currency"],
    ["Savings/Loan Variance", r.savingsLoanFund.variance, "currency"], ["Social Fund Expected", r.socialFund.expected, "currency"],
    ["Social Fund Actual", r.socialFund.actual, "currency"], ["Social Fund Variance", r.socialFund.variance, "currency"],
    ["Reconciled By", r.reconciledBy], ["Reconciliation Date", r.reconciledAt], ["Signature Recorded", r.signatureRecorded ? "YES" : "NO"], ["Notes", r.notes],
  ] : [["Status", r.status]] }]);
  sheet.views = [{ state: "frozen", ySplit: 4 }];
}

export function createMeetingReportWorkbook(report) {
  const workbook = createReportWorkbook(report.metadata.generatedAt);
  addSummary(workbook, report);
  addAttendance(workbook, report);
  addSavings(workbook, report);
  addSocialFund(workbook, report);
  addFines(workbook, report);
  addLoanRequests(workbook, report);
  addLoansAndRepayments(workbook, report);
  addReconciliation(workbook, report);
  return workbook;
}

export async function buildMeetingReportExcel(report) {
  return createMeetingReportWorkbook(report).xlsx.writeBuffer();
}

export function meetingReportFilename(report) {
  const meeting = String(report.metadata.meetingNumber).padStart(2, "0");
  return `Visave_${safeFilenamePart(report.metadata.groupCode)}_Cycle-${safeFilenamePart(report.metadata.cycleNumber)}_Meeting-${safeFilenamePart(meeting)}_${safeFilenamePart(report.metadata.reportStatus)}.xlsx`;
}
