import Link from "next/link";
import GroupNav from "@/components/group-nav";
import CycleReportView from "@/components/cycle-report-view";
import { requireAuth } from "@/lib/auth/session";
import { getCycleReport } from "@/modules/reports/cycle-report.service";

export const metadata = { title: "Cycle Report" };

export default async function CycleReportPage({ params }) {
  const { id, cycleId } = await params;
  const user = await requireAuth();
  let report;
  try {
    report = await getCycleReport(user, id, cycleId);
  } catch (error) {
    if (error?.code !== "REPORT_RECONCILIATION_FAILED") throw error;
    return <><h1>Cycle report unavailable</h1><GroupNav id={id}/><section className="panel report-integrity-error"><h2>Report reconciliation failed</h2><p>The historical report contains totals that do not agree. No export was generated.</p><ul>{(error.details?.checks || []).map((check) => <li key={check.name}>{check.name}: {check.left} versus {check.right}</li>)}</ul></section></>;
  }
  return <>
    <div className="report-page-heading"><div><p className="eyebrow">{report.metadata.groupCode}</p><h1>{report.metadata.groupName} · Cycle {report.metadata.cycleNumber}</h1><p className="muted">{report.metadata.cycleStatus === "CLOSED" ? "This report represents the completed historical cycle." : report.metadata.cycleStatus === "CLOSING" ? "Close-out activity is still in progress." : "Figures reflect posted activity recorded so far in this cycle."}</p></div><div><span className="badge">{report.metadata.reportStatus}</span><a className="button" href={`/api/v1/groups/${id}/cycles/${cycleId}/reports/excel`}>Download Excel</a></div></div>
    <p><a className="button secondary" href={`/api/v1/groups/${id}/cycles/${cycleId}/reports/pdf`}>Download PDF</a></p>
    <GroupNav id={id}/>
    <p><Link href={`/groups/${id}/reports`}>← All cycle reports</Link></p>
    <CycleReportView report={report}/>
  </>;
}
