import { CURRENCY_FORMAT, SECTION_FILL, addHeading, createReportWorkbook, currency, display, safeFilenamePart, writeKeyValueSections, writeTable } from "./report-excel";

function addReportHeading(sheet, report, width) {
  addHeading(sheet, [
    `Visave Cycle Report — ${report.metadata.groupName}`,
    `${report.metadata.groupCode} · Cycle ${report.metadata.cycleNumber} · ${report.metadata.reportStatus}`,
    `Generated ${report.metadata.generatedAt} by ${report.metadata.generatedBy.name || report.metadata.generatedBy.email || "Authorized user"}`,
  ], width);
  sheet.views = [{ state: "frozen", ySplit: 5 }];
}

function addTable(sheet, report, columns, data, options = {}) {
  addReportHeading(sheet, report, columns.length);
  return writeTable(sheet, columns, data, options);
}

function addKeyValueSheet(workbook, name, report, sections) {
  const sheet = workbook.addWorksheet(name);
  addReportHeading(sheet, report, 2);
  writeKeyValueSections(sheet, sections);
  sheet.views = [{ state: "frozen", ySplit: 4 }];
  return sheet;
}

function addCycleSummary(workbook, report) {
  const s = report.cycleSummary;
  return addKeyValueSheet(workbook, "Cycle Summary", report, [
    { title: "Group", rows: [
      ["Group Name", report.metadata.groupName], ["Group Code", report.metadata.groupCode], ["State", report.metadata.state],
      ["LGA", report.metadata.lga], ["Community", report.metadata.community], ["Operation Mode", report.metadata.operationMode],
    ] },
    { title: "Cycle", rows: [
      ["Cycle Number", report.metadata.cycleNumber], ["Cycle Status", report.metadata.cycleStatus], ["Report Status", report.metadata.reportStatus],
      ["Cycle Start Date", report.metadata.startDate], ["Expected End Date", report.metadata.expectedEndDate],
      ["Expected Share-out Date", report.metadata.expectedShareoutDate], ["Actual Closed Date", report.metadata.actualClosedDate],
      ["Cycle Participants", s.cycleParticipants], ["Meetings Held", s.meetingsHeld], ["Average Attendance", s.averageAttendance, "percent"],
    ] },
    { title: "Cycle Officers", rows: report.metadata.officers.length
      ? report.metadata.officers.map((officer) => [
        officer.position_code.replaceAll("_", " "),
        `${officer.member_name} (${officer.member_code})`,
      ])
      : [["Officers", "None recorded"]],
    },
    { title: "Financial Summary", rows: [
      ["Net Savings", s.netSavings, "currency"], ["Social Fund Member Contributions", s.socialFundMemberContributions, "currency"],
      ["Fines Assessed", s.finesAssessed, "currency"], ["Fines Collected", s.finesCollected, "currency"],
      ["Loans Disbursed", s.loansDisbursed, "currency"], ["Loan Repayments", s.loanRepayments, "currency"],
      ["Loan Service Charge Collected", s.loanServiceChargeCollected, "currency"], ["Outstanding Loans", s.outstandingLoans, "currency"],
      ["Share-out Distributable Fund", s.shareoutDistributableFund, "currency"], ["Share-out Entitlements", s.shareoutEntitlements, "currency"],
      ["Share-out Paid", s.shareoutPaid, "currency"], ["Social Fund Opening / Carry-in", s.socialFundOpeningCarryIn, "currency"],
      ["Social Fund Current / Closing Balance", s.socialFundCurrentClosingBalance, "currency"], ["Social Fund Carried Forward", s.socialFundCarriedForward, "currency"],
      ["Final Reconciliation Status", s.finalReconciliationStatus],
    ] },
  ]);
}

function addMeetingSummary(workbook, report) {
  const columns = [
    ["meetingNumber", "Meeting", 10], ["meetingDate", "Date", 14], ["meetingStatus", "Status", 14],
    ["eligibleParticipants", "Eligible", 11], ["present", "Present", 10], ["absent", "Absent", 10], ["late", "Late", 9], ["excused", "Excused", 10],
    ["savings", "Savings", 16, true], ["socialFundContributions", "Social Fund", 16, true], ["finesCollected", "Fines", 14, true],
    ["loansDisbursed", "Loans Disbursed", 18, true], ["loanRepayments", "Loan Repayments", 18, true],
    ["loanServiceChargeCollected", "Service Charge", 17, true], ["reconciliationStatus", "Reconciliation", 18],
  ].map(([key, header, width, isCurrency]) => ({ key, header, width, currency: isCurrency, value: (row) => isCurrency ? currency(row[key]) : display(row[key], "") }));
  addTable(workbook.addWorksheet("Meeting Summary"), report, columns, report.meetingSummary);
}

function addAttendance(workbook, report) {
  const columns = [
    { key: "memberCode", header: "Member Code", width: 20, value: (row) => row.member_code },
    { key: "memberName", header: "Member Name", width: 28, value: (row) => row.member_name },
    ...report.attendance.meetings.map((meeting) => ({ key: meeting.id, header: `M${meeting.meeting_number}`, width: 9, value: (row) => display(row.byMeeting[meeting.id], "") })),
    { key: "present", header: "Present", width: 10, value: (row) => row.totals.present },
    { key: "absent", header: "Absent", width: 10, value: (row) => row.totals.absent },
    { key: "late", header: "Late", width: 9, value: (row) => row.totals.late },
    { key: "excused", header: "Excused", width: 10, value: (row) => row.totals.excused },
  ];
  addTable(workbook.addWorksheet("Attendance Register"), report, columns, report.attendance.rows);
}

function addSavings(workbook, report) {
  const columns = [
    { key: "memberCode", header: "Member Code", width: 20, value: (row) => row.member_code },
    { key: "memberName", header: "Member Name", width: 28, value: (row) => row.member_name },
    ...report.savings.meetings.map((meeting) => ({ key: meeting.id, header: `M${meeting.meeting_number}`, width: 14, currency: true, value: (row) => row.byMeeting[meeting.id] === null ? "—" : currency(row.byMeeting[meeting.id]) })),
    { key: "totalShares", header: "Total Shares", width: 14, value: (row) => row.totalShares },
    { key: "totalSavings", header: "Total Savings", width: 18, currency: true, value: (row) => currency(row.totalSavings) },
  ];
  const totalRow = { memberCode: "TOTAL", totalShares: report.savings.totalShares, totalSavings: currency(report.savings.totalSavings) };
  for (const meeting of report.savings.meetings) totalRow[meeting.id] = currency(report.savings.meetingTotals[meeting.id]);
  addTable(workbook.addWorksheet("Savings Ledger"), report, columns, report.savings.rows, { totalRow });
}

function addSocialFund(workbook, report) {
  const columns = [
    { key: "memberCode", header: "Member Code", width: 20, value: (row) => row.member_code },
    { key: "memberName", header: "Member Name", width: 28, value: (row) => row.member_name },
    ...report.socialFund.meetings.map((meeting) => ({ key: meeting.id, header: `M${meeting.meeting_number}`, width: 14, currency: true, value: (row) => row.byMeeting[meeting.id] === null ? "—" : currency(row.byMeeting[meeting.id]) })),
    { key: "totalContribution", header: "Total Contribution", width: 20, currency: true, value: (row) => currency(row.totalContribution) },
  ];
  const sheet = addTable(workbook.addWorksheet("Social Fund Ledger"), report, columns, report.socialFund.rows);
  sheet.addRow([]);
  const title = sheet.addRow(["Fund Summary"]);
  title.font = { bold: true, color: { argb: "FF143D38" } };
  title.fill = SECTION_FILL;
  const summary = report.socialFund.summary;
  for (const [label, value] of [
    ["Opening / Carry-in", summary.openingCarryIn], ["Member Contributions", summary.memberContributions], ["Payouts", summary.payouts],
    ["Other Inflows", summary.otherInflows], ["Other Outflows", summary.otherOutflows], ["Current / Closing Balance", summary.currentClosingBalance],
    ["Carried Forward", summary.carriedForward],
  ]) {
    const row = sheet.addRow([label, value === null ? "Not available" : currency(value)]);
    row.getCell(1).font = { bold: true };
    if (typeof row.getCell(2).value === "number") row.getCell(2).numFmt = CURRENCY_FORMAT;
  }
}

function addFines(workbook, report) {
  const columns = [
    ["date", "Date", 14], ["meetingNumber", "Meeting", 10], ["memberCode", "Member Code", 18], ["memberName", "Member", 26],
    ["reason", "Reason", 30], ["amountAssessed", "Assessed", 15, true], ["amountPaid", "Paid", 15, true],
    ["amountReversed", "Reversed", 15, true], ["outstanding", "Outstanding", 15, true], ["status", "Status", 14],
  ].map(([key, header, width, isCurrency]) => ({ key, header, width, currency: isCurrency, value: (row) => isCurrency ? currency(row[key]) : display(row[key], "") }));
  addTable(workbook.addWorksheet("Fines Ledger"), report, columns, report.fines.rows, { totalRow: {
    date: "TOTAL", amountAssessed: currency(report.fines.totals.assessed), amountPaid: currency(report.fines.totals.collected),
    amountReversed: currency(report.fines.totals.reversed), outstanding: "Not available",
  } });
}

function addLoans(workbook, report) {
  const currencyKeys = new Set(["requestedAmount", "approvedAmount", "principalDisbursed", "serviceCharge", "totalDue", "totalRepaid", "principalOutstanding", "serviceChargeOutstanding"]);
  const columns = [
    ["loanCode", "Loan", 20], ["borrower", "Borrower", 25], ["memberCode", "Member Code", 18], ["purpose", "Purpose", 28],
    ["requestDate", "Request Date", 14], ["requestedAmount", "Requested", 15], ["approvedAmount", "Approved", 15],
    ["disbursementDate", "Disbursed Date", 15], ["principalDisbursed", "Principal", 15], ["serviceCharge", "Service Charge", 16],
    ["totalDue", "Total Due", 15], ["totalRepaid", "Total Repaid", 16], ["principalOutstanding", "Principal Outstanding", 20],
    ["serviceChargeOutstanding", "Charge Outstanding", 19], ["dueDate", "Due Date", 14], ["status", "Status", 17],
  ].map(([key, header, width]) => ({ key, header, width, currency: currencyKeys.has(key), value: (row) => currencyKeys.has(key) ? currency(row[key]) : display(row[key], "") }));
  addTable(workbook.addWorksheet("Loan Summary"), report, columns, report.loans.rows);
}

function addLoanTransactions(workbook, report) {
  const columns = [
    ["date", "Date", 14], ["meetingNumber", "Meeting", 10], ["borrower", "Borrower", 25], ["loanCode", "Loan", 20],
    ["reference", "Reference", 24], ["transactionType", "Transaction Type", 27], ["amount", "Amount", 15, true],
    ["principalComponent", "Principal", 15, true], ["serviceChargeComponent", "Service Charge", 16, true], ["isReversal", "Reversal", 11],
  ].map(([key, header, width, isCurrency]) => ({ key, header, width, currency: isCurrency, value: (row) => isCurrency ? currency(row[key]) : display(row[key], "") }));
  addTable(workbook.addWorksheet("Loan Transactions"), report, columns, report.loanTransactions);
}

function addCashbook(workbook, report) {
  const data = [
    ...report.cashbook.savingsLoan.map((row) => ({ ...row, fund: "SAVINGS / LOAN FUND" })),
    ...report.cashbook.socialFund.map((row) => ({ ...row, fund: "SOCIAL FUND" })),
  ];
  const columns = [
    ["fund", "Fund", 23], ["date", "Date", 14], ["meetingNumber", "Meeting", 10], ["reference", "Reference", 24],
    ["description", "Transaction Type", 28], ["account", "Account", 26], ["debit", "Debit", 16, true], ["credit", "Credit", 16, true],
  ].map(([key, header, width, isCurrency]) => ({ key, header, width, currency: isCurrency, value: (row) => isCurrency ? currency(row[key]) : display(row[key], "") }));
  addTable(workbook.addWorksheet("Cashbook"), report, columns, data);
}

function addShareout(workbook, report) {
  const columns = [
    ["memberCode", "Member Code", 18], ["memberName", "Member", 26], ["netSavings", "Net Savings", 16, true],
    ["shareRatio", "Share Ratio", 14, false, true], ["entitlement", "Entitlement", 16, true], ["paid", "Paid", 16, true], ["remaining", "Remaining", 16, true],
  ].map(([key, header, width, isCurrency, isPercent]) => ({ key, header, width, currency: isCurrency, percent: isPercent, value: (row) => isCurrency ? currency(row[key]) : display(row[key], "") }));
  const data = report.shareout.rows.length ? report.shareout.rows : [{ memberCode: report.shareout.status, memberName: report.shareout.socialFundTreatment }];
  const sheet = addTable(workbook.addWorksheet("Share-out"), report, columns, data);
  if (report.shareout.summary) {
    sheet.addRow([]);
    for (const [label, value] of Object.entries(report.shareout.summary)) {
      const row = sheet.addRow([label.replaceAll(/([A-Z])/g, " $1"), currency(value)]);
      row.getCell(1).font = { bold: true };
      row.getCell(2).numFmt = CURRENCY_FORMAT;
    }
  }
}

function addClosure(workbook, report) {
  const closure = report.closure;
  addKeyValueSheet(workbook, "Cycle Closure", report, [
    { title: "Final Meeting", rows: [
      ["Final Meeting", closure.finalMeeting?.meetingNumber], ["Final Meeting Date", closure.finalMeeting?.meetingDate], ["Final Meeting Status", closure.finalMeeting?.status],
      ["Share-out Status", closure.shareoutStatus], ["Participants Paid / Total", `${closure.participantsPaid} / ${closure.participantsTotal}`],
    ] },
    { title: "Final Financial Position", rows: [
      ["Savings/Loan Cash Final Balance", closure.savingsLoanCashFinalBalance, "currency"], ["Loans Receivable Final Balance", closure.loansReceivableFinalBalance, "currency"],
      ["Share-out Payable Final Balance", closure.shareoutPayableFinalBalance, "currency"], ["Social Fund Carried Forward", closure.socialFundCarriedForward, "currency"],
      ["Final Reconciliation Status", closure.finalReconciliationStatus], ["Final Reconciliation Date", closure.finalReconciliationDate],
      ["Signature Recorded", closure.signatureRecorded ? "YES" : "NO"], ["Cycle Closed Date", closure.cycleClosedDate],
      ["Cycle Closed By", closure.cycleClosedBy], ["Next Cycle Number", closure.nextCycle?.cycle_number],
    ] },
  ]);
}

export function createCycleReportWorkbook(report) {
  const workbook = createReportWorkbook(report.metadata.generatedAt);
  addCycleSummary(workbook, report);
  addMeetingSummary(workbook, report);
  addAttendance(workbook, report);
  addSavings(workbook, report);
  addSocialFund(workbook, report);
  addFines(workbook, report);
  addLoans(workbook, report);
  addLoanTransactions(workbook, report);
  addCashbook(workbook, report);
  addShareout(workbook, report);
  addClosure(workbook, report);
  return workbook;
}

export async function buildCycleReportExcel(report) {
  return createCycleReportWorkbook(report).xlsx.writeBuffer();
}

export function cycleReportFilename(report) {
  return `Visave_${safeFilenamePart(report.metadata.groupCode)}_Cycle-${safeFilenamePart(report.metadata.cycleNumber)}_${safeFilenamePart(report.metadata.reportStatus)}.xlsx`;
}
