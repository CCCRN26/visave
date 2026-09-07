import { formatCurrency } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/date";
import { ReportTable, Section } from "./cycle-report-view";

const money = (amount) => amount === null || amount === undefined ? "Not available" : formatCurrency(amount);
const text = (value, fallback = "Not available") => value === null || value === undefined || value === "" ? fallback : value;

export default function MeetingReportView({ report }) {
  const s = report.meetingSummary;
  const cards = [
    ["Eligible participants", s.eligibleParticipants], ["Present", s.present], ["Absent", s.absent], ["Late", s.late], ["Excused", s.excused],
    ["Net savings", money(s.netSavings)], ["Social Fund contributions", money(s.socialFundContributions)],
    ["Fines assessed", money(s.finesAssessed)], ["Fines collected", money(s.finesCollected)],
    ["Loan requests", s.loanRequests], ["Loans approved", s.loansApproved], ["Loans rejected", s.loansRejected],
    ["Loans disbursed", s.loansDisbursed], ["Principal disbursed", money(s.loanPrincipalDisbursed)],
    ["Loan repayments", money(s.loanRepayments)], ["Service charge collected", money(s.serviceChargeCollected)],
  ];
  return <div className="cycle-report meeting-report">
    <Section eyebrow="Meeting summary" title="What happened in this meeting">
      <dl className="report-metadata">
        <div><dt>Meeting</dt><dd>Meeting {s.meetingNumber} · {formatDate(s.meetingDate)}</dd></div>
        <div><dt>Status</dt><dd>{s.meetingStatus}</dd></div>
        <div><dt>Reconciliation</dt><dd>{s.reconciliationStatus}</dd></div>
        <div><dt>Opened</dt><dd>{formatDateTime(report.metadata.openedAt)} by {text(report.metadata.openedBy)}</dd></div>
        <div><dt>Closed</dt><dd>{report.metadata.closedAt ? `${formatDateTime(report.metadata.closedAt)} by ${text(report.metadata.closedBy)}` : "Not available"}</dd></div>
        <div><dt>Cycle officers</dt><dd>{report.metadata.officers.length ? report.metadata.officers.map((officer) => `${officer.position_code.replaceAll("_", " ")}: ${officer.member_name}`).join("; ") : "None recorded"}</dd></div>
      </dl>
      <div className="report-summary-grid">{cards.map(([label, value]) => <article className="panel" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    </Section>

    <Section eyebrow="Participation" title="Attendance">
      <ReportTable headers={["Member Code", "Member Name", "Attendance Status", "Notes", "Recorded At"]} rows={report.attendance.rows.map((row) => <tr key={row.memberId}><td>{row.memberCode}</td><td>{row.memberName}</td><td>{row.status}</td><td>{text(row.notes, "")}</td><td>{row.recordedAt ? formatDateTime(row.recordedAt) : ""}</td></tr>)}/>
    </Section>

    <Section eyebrow="Savings" title="Meeting savings">
      <ReportTable headers={["Member Code", "Member Name", "Shares Purchased", "Shares Reversed", "Purchases", "Reversals", "Net Savings"]} rows={report.savings.rows.map((row) => <tr key={row.memberId}><td>{row.memberCode}</td><td>{row.memberName}</td><td>{row.sharesPurchased}</td><td>{row.sharesReversed}</td><td>{money(row.purchases)}</td><td>{money(row.reversal)}</td><td>{money(row.netSavings)}</td></tr>)}/>
    </Section>

    <Section eyebrow="Social Fund" title="Member contributions">
      <ReportTable headers={["Member Code", "Member Name", "Contribution", "Reversal", "Net Contribution"]} rows={report.socialFund.rows.map((row) => <tr key={row.memberId}><td>{row.memberCode}</td><td>{row.memberName}</td><td>{money(row.contribution)}</td><td>{money(row.reversal)}</td><td>{money(row.netContribution)}</td></tr>)}/>
      <p className="muted">Standalone Social Fund payouts: {report.socialFund.payouts === null ? "Not available" : money(report.socialFund.payouts)}</p>
    </Section>

    <Section eyebrow="Fines" title="Fine activity">
      <ReportTable headers={["Member Code", "Member Name", "Reason", "Assessed", "Collected", "Reversed", "Outstanding", "Status"]} rows={report.fines.rows.map((row) => <tr key={row.id}><td>{row.memberCode}</td><td>{row.memberName}</td><td>{row.reason}</td><td>{money(row.amountAssessed)}</td><td>{money(row.amountPaid)}</td><td>{money(row.amountReversed)}</td><td>{money(row.outstanding)}</td><td>{row.status}</td></tr>)}/>
    </Section>

    <Section eyebrow="Loans" title="Loan requests">
      <ReportTable headers={["Request", "Borrower", "Purpose", "Requested", "Approved", "Status", "Requested By", "Decided By"]} rows={report.loanRequests.map((row) => <tr key={row.id}><td>{row.requestCode}</td><td>{row.memberCode}<br/><small>{row.borrower}</small></td><td>{text(row.purpose)}</td><td>{money(row.requestedAmount)}</td><td>{money(row.approvedAmount)}</td><td>{row.status}</td><td>{row.requestedBy}</td><td>{text(row.decidedBy, "")}</td></tr>)}/>
    </Section>

    <Section eyebrow="Loans" title="Loans disbursed">
      <ReportTable headers={["Loan", "Borrower", "Purpose", "Principal", "Service Charge", "Total Due", "Term", "Due Date", "Disbursed By", "Status"]} rows={report.loans.map((row) => <tr key={row.id}><td>{row.loanCode}</td><td>{row.memberCode}<br/><small>{row.borrower}</small></td><td>{text(row.purpose)}</td><td>{money(row.principal)}</td><td>{money(row.serviceCharge)}</td><td>{money(row.totalDue)}</td><td>{row.termMonths} months</td><td>{formatDate(row.dueDate)}</td><td>{row.disbursedBy}</td><td>{row.status}</td></tr>)}/>
    </Section>

    <Section eyebrow="Loans" title="Loan repayments">
      <ReportTable headers={["Date", "Loan", "Borrower", "Type", "Amount Paid", "Principal", "Service Charge", "Remaining Balance"]} rows={report.loanRepayments.rows.map((row) => <tr key={row.id}><td>{formatDate(row.date)}</td><td>{row.loanCode}</td><td>{row.memberCode}<br/><small>{row.borrower}</small></td><td>{row.transactionType}</td><td>{money(row.amountPaid)}</td><td>{money(row.principalComponent)}</td><td>{money(row.serviceChargeComponent)}</td><td>{money(row.remainingBalance)}</td></tr>)}/>
    </Section>

    <Section eyebrow="Controls" title="Reconciliation">
      {report.reconciliation.available ? <dl className="report-fund-summary">
        <div><dt>Expected Cash</dt><dd>{money(report.reconciliation.expectedCash)}</dd></div><div><dt>Actual Cash</dt><dd>{money(report.reconciliation.actualCash)}</dd></div>
        <div><dt>Variance</dt><dd>{money(report.reconciliation.variance)}</dd></div><div><dt>Status</dt><dd>{report.reconciliation.status}</dd></div>
        <div><dt>Savings/Loan Fund</dt><dd>{money(report.reconciliation.savingsLoanFund.actual)}</dd></div><div><dt>Social Fund</dt><dd>{money(report.reconciliation.socialFund.actual)}</dd></div>
        <div><dt>Reconciled By</dt><dd>{report.reconciliation.reconciledBy}</dd></div><div><dt>Reconciliation Date</dt><dd>{formatDateTime(report.reconciliation.reconciledAt)}</dd></div>
        <div><dt>Signature Recorded</dt><dd>{report.reconciliation.signatureRecorded ? "YES" : "NO"}</dd></div>
      </dl> : <section className="panel dashboard-empty"><p>Not yet reconciled</p></section>}
    </Section>
    <p className="report-generated">Generated {formatDateTime(report.metadata.generatedAt)} by {text(report.metadata.generatedBy.name, report.metadata.generatedBy.email || "Authorized user")} · Integrity {report.integrity.status}</p>
  </div>;
}
