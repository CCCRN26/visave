import { formatCurrency } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import Link from "next/link";

const money = (value) => value === null || value === undefined ? "Not available" : formatCurrency(value);
const value = (item, fallback = "Not available") => item === null || item === undefined || item === "" ? fallback : item;
const meetingLabel = (number) => number ? `Meeting ${number}` : "—";

export function ReportTable({ headers, rows, empty = "None recorded" }) {
  return <div className="panel table-wrap report-table"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.length ? rows : <tr><td colSpan={headers.length} className="muted">{empty}</td></tr>}</tbody></table></div>;
}

export function Section({ eyebrow, title, children }) {
  return <section className="report-section"><header><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></header>{children}</section>;
}

export default function CycleReportView({ report }) {
  const summary = report.cycleSummary;
  const summaryCards = [
    ["Participants", summary.cycleParticipants], ["Meetings held", summary.meetingsHeld],
    ["Average attendance", summary.averageAttendance === null ? "Not available" : `${summary.averageAttendance.toFixed(2)}%`],
    ["Net savings", money(summary.netSavings)], ["Social Fund contributions", money(summary.socialFundMemberContributions)],
    ["Fines assessed", money(summary.finesAssessed)], ["Fines collected", money(summary.finesCollected)],
    ["Loans disbursed", money(summary.loansDisbursed)], ["Loan repayments", money(summary.loanRepayments)],
    ["Service charge collected", money(summary.loanServiceChargeCollected)], ["Outstanding loans", money(summary.outstandingLoans)],
    ["Social Fund balance", money(summary.socialFundCurrentClosingBalance)],
  ];
  return <div className="cycle-report">
    <Section eyebrow="Cycle summary" title="Cycle at a glance">
      <dl className="report-metadata">
        <div><dt>State / LGA</dt><dd>{value(report.metadata.state)} / {value(report.metadata.lga)}</dd></div>
        <div><dt>Community</dt><dd>{value(report.metadata.community)}</dd></div>
        <div><dt>Operation mode</dt><dd>{report.metadata.operationMode.replaceAll("_", " ")}</dd></div>
        <div><dt>Cycle dates</dt><dd>{formatDate(report.metadata.startDate)} – {formatDate(report.metadata.expectedEndDate)}</dd></div>
        <div><dt>Expected share-out</dt><dd>{formatDate(report.metadata.expectedShareoutDate)}</dd></div>
        <div><dt>Actual close</dt><dd>{formatDate(report.metadata.actualClosedDate)}</dd></div>
        <div><dt>Cycle officers</dt><dd>{report.metadata.officers.length ? report.metadata.officers.map((officer) => `${officer.position_code.replaceAll("_", " ")}: ${officer.member_name}`).join("; ") : "None recorded"}</dd></div>
      </dl>
      <div className="report-summary-grid">{summaryCards.map(([label,amount]) => <article className="panel" key={label}><span>{label}</span><strong>{amount}</strong></article>)}</div>
    </Section>

    <Section eyebrow="Meetings" title="Meeting summary">
      <ReportTable headers={["Meeting", "Date", "Status", "Eligible", "P", "A", "L", "E", "Savings", "Social Fund", "Fines", "Loans", "Repayments", "Reconciliation", "Report"]} rows={report.meetingSummary.map((meeting) => <tr key={meeting.id}><td>{meetingLabel(meeting.meetingNumber)}</td><td>{formatDate(meeting.meetingDate)}</td><td>{meeting.meetingStatus}</td><td>{meeting.eligibleParticipants}</td><td>{meeting.present}</td><td>{meeting.absent}</td><td>{meeting.late}</td><td>{meeting.excused}</td><td>{money(meeting.savings)}</td><td>{money(meeting.socialFundContributions)}</td><td>{money(meeting.finesCollected)}</td><td>{money(meeting.loansDisbursed)}</td><td>{money(meeting.loanRepayments)}</td><td>{value(meeting.reconciliationStatus)}</td><td><Link href={`/groups/${report.metadata.groupId}/reports/cycles/${report.metadata.cycleId}/meetings/${meeting.id}`}>View Meeting Report</Link></td></tr>)}/>
    </Section>

    <Section eyebrow="Member statements" title="Cycle participants">
      <ReportTable headers={["Member", "Statement"]} rows={report.attendance.rows.map((row) => <tr key={row.member_id}><td>{row.member_code}<br/><small>{row.member_name}</small></td><td><Link href={`/groups/${report.metadata.groupId}/reports/cycles/${report.metadata.cycleId}/members/${row.member_id}`}>View Statement</Link></td></tr>)}/>
    </Section>

    <Section eyebrow="Participation" title="Attendance register">
      <ReportTable headers={["Member", ...report.attendance.meetings.map((meeting) => `M${meeting.meeting_number}`), "Present", "Absent", "Late", "Excused"]} rows={report.attendance.rows.map((row) => <tr key={row.member_id}><td>{row.member_code}<br/><small>{row.member_name}</small></td>{report.attendance.meetings.map((meeting) => <td key={meeting.id}>{value(row.byMeeting[meeting.id], "")}</td>)}<td>{row.totals.present}</td><td>{row.totals.absent}</td><td>{row.totals.late}</td><td>{row.totals.excused}</td></tr>)}/>
    </Section>

    <Section eyebrow="Savings" title="Member savings ledger">
      <ReportTable headers={["Member", ...report.savings.meetings.map((meeting) => `M${meeting.meeting_number}`), "Shares", "Total savings"]} rows={report.savings.rows.map((row) => <tr key={row.member_id}><td>{row.member_code}<br/><small>{row.member_name}</small></td>{report.savings.meetings.map((meeting) => <td key={meeting.id}>{row.byMeeting[meeting.id] === null ? "—" : money(row.byMeeting[meeting.id])}</td>)}<td>{row.totalShares}</td><td>{money(row.totalSavings)}</td></tr>)}/>
    </Section>

    <Section eyebrow="Social Fund" title="Member contributions and fund position">
      <ReportTable headers={["Member", ...report.socialFund.meetings.map((meeting) => `M${meeting.meeting_number}`), "Total contribution"]} rows={report.socialFund.rows.map((row) => <tr key={row.member_id}><td>{row.member_code}<br/><small>{row.member_name}</small></td>{report.socialFund.meetings.map((meeting) => <td key={meeting.id}>{row.byMeeting[meeting.id] === null ? "—" : money(row.byMeeting[meeting.id])}</td>)}<td>{money(row.totalContribution)}</td></tr>)}/>
      <dl className="report-fund-summary"><div><dt>Opening / carry-in</dt><dd>{money(report.socialFund.summary.openingCarryIn)}</dd></div><div><dt>Member contributions</dt><dd>{money(report.socialFund.summary.memberContributions)}</dd></div><div><dt>Payouts</dt><dd>{money(report.socialFund.summary.payouts)}</dd></div><div><dt>Current / closing balance</dt><dd>{money(report.socialFund.summary.currentClosingBalance)}</dd></div><div><dt>Carried forward</dt><dd>{money(report.socialFund.summary.carriedForward)}</dd></div></dl>
    </Section>

    <Section eyebrow="Fines" title="Fines ledger">
      <ReportTable headers={["Date", "Meeting", "Member", "Reason", "Assessed", "Paid", "Reversed", "Outstanding", "Status"]} rows={report.fines.rows.map((fine) => <tr key={fine.id}><td>{formatDate(fine.date)}</td><td>{meetingLabel(fine.meetingNumber)}</td><td>{fine.memberCode}<br/><small>{fine.memberName}</small></td><td>{fine.reason}</td><td>{money(fine.amountAssessed)}</td><td>{money(fine.amountPaid)}</td><td>{money(fine.amountReversed)}</td><td>{money(fine.outstanding)}</td><td>{fine.status}</td></tr>)}/>
    </Section>

    <Section eyebrow="Loans" title="Loan summary">
      <ReportTable headers={["Loan", "Borrower", "Requested", "Principal", "Service charge", "Repaid", "Principal outstanding", "Charge outstanding", "Due", "Status"]} rows={report.loans.rows.map((loan) => <tr key={loan.id}><td>{loan.loanCode}</td><td>{loan.memberCode}<br/><small>{loan.borrower}</small></td><td>{money(loan.requestedAmount)}</td><td>{money(loan.principalDisbursed)}</td><td>{money(loan.serviceCharge)}</td><td>{money(loan.totalRepaid)}</td><td>{money(loan.principalOutstanding)}</td><td>{money(loan.serviceChargeOutstanding)}</td><td>{formatDate(loan.dueDate)}</td><td>{loan.status}</td></tr>)}/>
      <details className="panel report-detail"><summary>Loan transaction history</summary><ReportTable headers={["Date", "Meeting", "Borrower", "Loan", "Type", "Amount", "Principal", "Service charge", "Reversal"]} rows={report.loanTransactions.map((transaction) => <tr key={transaction.id}><td>{formatDate(transaction.date)}</td><td>{meetingLabel(transaction.meetingNumber)}</td><td>{transaction.borrower}</td><td>{transaction.loanCode}</td><td>{transaction.transactionType}</td><td>{money(transaction.amount)}</td><td>{money(transaction.principalComponent)}</td><td>{money(transaction.serviceChargeComponent)}</td><td>{transaction.isReversal ? "YES" : "NO"}</td></tr>)}/></details>
    </Section>

    <Section eyebrow="Share-out" title="Cycle Share-out">
      <p><span className="badge">{report.shareout.status}</span> <strong>{report.shareout.socialFundTreatment}</strong></p>
      <ReportTable headers={["Member", "Net savings", "Share ratio", "Entitlement", "Paid", "Remaining"]} empty="Share-out has not started." rows={report.shareout.rows.map((row) => <tr key={row.memberId}><td>{row.memberCode}<br/><small>{row.memberName}</small></td><td>{money(row.netSavings)}</td><td>{row.shareRatio === null ? "—" : `${(row.shareRatio * 100).toFixed(2)}%`}</td><td>{money(row.entitlement)}</td><td>{money(row.paid)}</td><td>{money(row.remaining)}</td></tr>)}/>
      {report.shareout.summary && <dl className="report-fund-summary"><div><dt>Distributable fund</dt><dd>{money(report.shareout.summary.distributableFund)}</dd></div><div><dt>Total entitlements</dt><dd>{money(report.shareout.summary.totalEntitlements)}</dd></div><div><dt>Total paid</dt><dd>{money(report.shareout.summary.totalPaid)}</dd></div><div><dt>Outstanding payable</dt><dd>{money(report.shareout.summary.outstandingPayable)}</dd></div></dl>}
    </Section>

    <Section eyebrow="Closure" title="Cycle closure">
      <dl className="report-metadata"><div><dt>Final meeting</dt><dd>{report.closure.finalMeeting ? `${meetingLabel(report.closure.finalMeeting.meetingNumber)} · ${formatDate(report.closure.finalMeeting.meetingDate)} · ${report.closure.finalMeeting.status}` : "Not available"}</dd></div><div><dt>Share-out status</dt><dd>{report.closure.shareoutStatus}</dd></div><div><dt>Participants paid</dt><dd>{report.closure.participantsPaid} / {report.closure.participantsTotal}</dd></div><div><dt>Savings/Loan cash</dt><dd>{money(report.closure.savingsLoanCashFinalBalance)}</dd></div><div><dt>Loans receivable</dt><dd>{money(report.closure.loansReceivableFinalBalance)}</dd></div><div><dt>Share-out payable</dt><dd>{money(report.closure.shareoutPayableFinalBalance)}</dd></div><div><dt>Social Fund carried forward</dt><dd>{money(report.closure.socialFundCarriedForward)}</dd></div><div><dt>Final reconciliation</dt><dd>{value(report.closure.finalReconciliationStatus)}{report.closure.finalReconciliationDate ? ` · ${formatDateTime(report.closure.finalReconciliationDate)}` : ""}</dd></div><div><dt>Signature recorded</dt><dd>{report.closure.signatureRecorded ? "YES" : "NO"}</dd></div><div><dt>Cycle closed</dt><dd>{formatDateTime(report.closure.cycleClosedDate)}</dd></div><div><dt>Next cycle</dt><dd>{report.closure.nextCycle ? `Cycle ${report.closure.nextCycle.cycle_number}` : "None"}</dd></div></dl>
    </Section>

    <details className="panel report-detail"><summary>Audit cashbook</summary><h3>Savings / Loan Fund</h3><ReportTable headers={["Date", "Meeting", "Reference", "Transaction", "Account", "Debit", "Credit"]} rows={report.cashbook.savingsLoan.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{meetingLabel(row.meetingNumber)}</td><td>{row.reference}</td><td>{row.description}</td><td>{row.account}</td><td>{money(row.debit)}</td><td>{money(row.credit)}</td></tr>)}/><h3>Social Fund</h3><ReportTable headers={["Date", "Meeting", "Reference", "Transaction", "Account", "Debit", "Credit"]} rows={report.cashbook.socialFund.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{meetingLabel(row.meetingNumber)}</td><td>{row.reference}</td><td>{row.description}</td><td>{row.account}</td><td>{money(row.debit)}</td><td>{money(row.credit)}</td></tr>)}/></details>
    <p className="report-generated">Generated {formatDateTime(report.metadata.generatedAt)} by {value(report.metadata.generatedBy.name, report.metadata.generatedBy.email || "Authorized user")} · Reconciliation {report.reconciliation.status}</p>
  </div>;
}
