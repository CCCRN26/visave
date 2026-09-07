import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getLoan } from "@/modules/loans/loan.service";
import GroupNav from "@/components/group-nav";
import { formatCurrency } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/date";

export default async function Loan({ params }) {
  const { id, loanId } = await params;
  const user = await requireAuth();
  await requireGroupRouteAction(user, id, "loan.view", GROUP_ACTION.LOAN_VIEW);
  const { loan, repayments } = await getLoan(id, loanId);
  const details = [
    ["Principal", formatCurrency(loan.principal_disbursed)],
    ["Contractual Charge", formatCurrency(loan.service_charge_total_due)],
    ["Total Due", formatCurrency(loan.total_contractual_due)],
    ["Principal Repaid", formatCurrency(loan.principal_repaid)],
    ["Principal Outstanding", formatCurrency(loan.principal_outstanding)],
    ["Charge Collected", formatCurrency(loan.service_charge_collected)],
    ["Charge Remaining", formatCurrency(loan.service_charge_remaining)],
    ["Total Outstanding", formatCurrency(loan.total_outstanding)],
    ["Request Date", formatDateTime(loan.requested_at)],
    ["Approval Date", formatDateTime(loan.decided_at)],
    ["Disbursement Date", formatDate(loan.disbursement_date)],
    ["Due Date", formatDate(loan.due_date)],
    ["Days Overdue", loan.days_overdue],
  ];
  return <>
    <h1>{loan.loan_code}</h1>
    <p className="muted">{loan.member_name} · {loan.member_code} · <span className="badge">{loan.display_status}</span></p>
    <GroupNav id={id}/>
    <section className="panel" style={{ padding: 18, marginBottom: 18 }}><h2>Loan purpose</h2><p>{loan.purpose || "No purpose was recorded for this legacy request."}</p><p className="muted">Recorded by {loan.requested_by_name} · Approved by {loan.decided_by_name} · Disbursed by {loan.disbursed_by_name}</p></section>
    <div className="grid cards">{details.map(([label, value]) => <article className="panel" style={{ padding: 18 }} key={label}><small className="muted">{label}</small><h3>{value}</h3></article>)}</div>
    <h2>Repayment history</h2>
    <div className="panel table-wrap"><table><thead><tr><th>Date</th><th>Reference</th><th>Kind</th><th>Payment</th><th>Principal</th><th>Service Charge</th></tr></thead><tbody>{repayments.map((row) => <tr key={row.id}><td>{formatDateTime(row.transaction_at)}</td><td>{row.reference_code}</td><td>{row.transaction_kind}</td><td>{formatCurrency(row.payment_amount)}</td><td>{formatCurrency(row.principal_component)}</td><td>{formatCurrency(row.service_charge_component)}</td></tr>)}</tbody></table></div>
  </>;
}
