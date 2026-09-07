import Link from "next/link";
import { requireAuth } from "@/lib/auth/session";
import { getMyGroupActivity } from "@/modules/member-self/member-self.service";
import { formatCurrency } from "@/lib/utils/money";
import { formatDate, formatDateTime } from "@/lib/utils/date";

function Detail({ label, value }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

export default async function MyActivity({ params, searchParams }) {
  const { id } = await params;
  const user = await requireAuth();
  const selected=await searchParams;
  const data = await getMyGroupActivity(id,user,undefined,selected.cycleId||null);
  const { membership, summary, loan, shareout, activity,cycles } = data;
  const location = [membership.location.community, membership.location.lga, membership.location.state].filter(Boolean).join(" · ");
  const cards = [
    ["My Savings", formatCurrency(summary.savingsAmount), `${summary.savingsShares} shares`],
    ["My Social Fund", formatCurrency(summary.socialFundAmount), "Current cycle contributions"],
    ["My Fines", formatCurrency(summary.finesAmount), "Current cycle recorded fines"],
    ["Outstanding Loan", formatCurrency(summary.outstandingLoan), loan ? loan.status.replaceAll("_", " ") : "No outstanding loan"],
    ["My Share-out", summary.shareoutAmount ? formatCurrency(summary.shareoutAmount) : "Not available", shareout ? shareout.status.replaceAll("_", " ") : "Not yet available for this cycle"],
  ];
  return <main className="member-activity-page">
    <Link href="/my-groups" className="member-activity-back">← My Groups</Link>
    <header className="member-activity-hero">
      <p className="eyebrow">My group activity</p><h1>{membership.groupName}</h1>
      {location && <p>{location}</p>}
      <div><span className="badge">Cycle {membership.cycleNumber}</span><span className="badge">{membership.membershipStatus}</span></div>
    </header>
    <section className="member-welcome"><div><p className="eyebrow">Member profile</p><h2>Welcome, {membership.memberName}</h2><p className="muted">Member code: {membership.memberCode}{membership.officerPosition ? ` · ${membership.officerPosition.replaceAll("_", " ")}` : ""}</p></div></section>
    <nav className="panel" style={{padding:16,marginBottom:18}} aria-label="My cycle history"><strong>My cycles</strong> {cycles.map(c=><Link className="button secondary" key={c.id} href={`/my-groups/${id}/my-activity?cycleId=${c.id}`}>Cycle {c.cycle_number}</Link>)}</nav>
    <section aria-labelledby="member-summary-title"><h2 id="member-summary-title">My financial summary</h2><div className="member-summary-grid">{cards.map(([label,value,help])=><article className="panel" key={label}><span>{label}</span><strong>{value}</strong><small>{help}</small></article>)}</div></section>
    <section className="panel member-loan-card" aria-labelledby="member-loan-title"><p className="eyebrow">My loan</p><h2 id="member-loan-title">{loan ? "Current loan position" : "No outstanding loan"}</h2>{loan ? <div className="member-detail-grid"><Detail label="Principal" value={formatCurrency(loan.principal)}/><Detail label="Service charge" value={formatCurrency(loan.serviceCharge)}/><Detail label="Amount repaid" value={formatCurrency(loan.amountRepaid)}/><Detail label="Outstanding" value={formatCurrency(loan.totalOutstanding)}/><Detail label="Due date" value={formatDate(loan.dueDate)}/><Detail label="Status" value={loan.status.replaceAll("_", " ")}/>{loan.purpose&&<Detail label="Purpose" value={loan.purpose}/>}</div>:<p className="muted">You do not have a loan recorded for the current cycle.</p>}</section>
    <section aria-labelledby="member-activity-title"><h2 id="member-activity-title">My recent activity</h2>{activity.length ? <div className="member-activity-list">{activity.map((entry,index)=><article className="panel" key={`${entry.date}-${entry.type}-${index}`}><div><strong>{entry.type}</strong><span>{entry.meeting || "Group activity"} · {formatDateTime(entry.date)}</span></div><div><strong>{formatCurrency(entry.amount)}</strong><span>{entry.status}</span></div></article>)}</div>:<div className="panel member-activity-empty">No activity has been recorded for you in this cycle.</div>}</section>
  </main>;
}
