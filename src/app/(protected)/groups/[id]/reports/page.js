import Link from "next/link";
import GroupNav from "@/components/group-nav";
import { requireAuth } from "@/lib/auth/session";
import { formatDate } from "@/lib/utils/date";
import { listCycleReports } from "@/modules/reports/cycle-report.service";

export const metadata = { title: "Group Reports" };

export default async function GroupReports({ params }) {
  const { id } = await params;
  const user = await requireAuth();
  const cycles = await listCycleReports(user, id);
  return <>
    <div className="group-overview-heading"><div><p className="eyebrow">Group reporting</p><h1>Reports</h1><p className="muted">View current progress and completed historical cycle reports.</p></div></div>
    <GroupNav id={id}/>
    <div className="report-cycle-list">
      {cycles.map((cycle) => <article className="panel report-cycle-card" key={cycle.id}>
        <div><h2>Cycle {cycle.cycle_number}</h2><span className={`badge report-status-${cycle.status.toLowerCase()}`}>{cycle.reportStatus}</span></div>
        <p>{formatDate(cycle.start_date)} – {formatDate(cycle.expected_end_date)}</p>
        <small>{cycle.status === "CLOSED" ? "This report represents the completed historical cycle." : cycle.status === "CLOSING" ? "Close-out activity is still in progress." : "Figures reflect posted activity recorded so far in this cycle."}</small>
        <div className="report-actions"><Link className="button secondary" href={`/groups/${id}/reports/cycles/${cycle.id}`}>View Report</Link><a className="button" href={`/api/v1/groups/${id}/cycles/${cycle.id}/reports/excel`}>Download Excel</a></div>
      </article>)}
      {!cycles.length && <section className="panel dashboard-empty"><h2>No cycle reports available</h2><p>Reports become available when a cycle is active, closing, or closed.</p></section>}
    </div>
  </>;
}
