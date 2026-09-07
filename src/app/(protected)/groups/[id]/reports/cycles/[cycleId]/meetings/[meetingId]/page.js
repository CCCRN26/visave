import Link from "next/link";
import GroupNav from "@/components/group-nav";
import MeetingReportView from "@/components/meeting-report-view";
import { requireAuth } from "@/lib/auth/session";
import { getMeetingReport } from "@/modules/reports/meeting-report.service";
import { formatDate } from "@/lib/utils/date";

export const metadata = { title: "Meeting Report" };

export default async function MeetingReportPage({ params }) {
  const { id, cycleId, meetingId } = await params;
  const user = await requireAuth();
  let report;
  try {
    report = await getMeetingReport(user, id, cycleId, meetingId);
  } catch (error) {
    if (error?.code !== "MEETING_REPORT_RECONCILIATION_FAILED") throw error;
    return <><h1>Meeting report unavailable</h1><GroupNav id={id}/><section className="panel report-integrity-error"><h2>Report reconciliation failed</h2><p>The closed meeting contains totals that do not agree. No export was generated.</p><ul>{(error.details?.checks || []).map((check) => <li key={check.name}>{check.name}: {check.left} versus {check.right}</li>)}</ul></section></>;
  }
  return <>
    <div className="report-page-heading">
      <div><p className="eyebrow">Visave · Meeting Report</p><h1>{report.metadata.groupName} · Meeting {report.metadata.meetingNumber}</h1><p className="muted">Cycle {report.metadata.cycleNumber} · {formatDate(report.metadata.meetingDate)} · {report.metadata.meetingStatus}</p></div>
      <div><span className="badge">{report.metadata.reportStatus}</span><a className="button" href={`/api/v1/groups/${id}/cycles/${cycleId}/meetings/${meetingId}/reports/excel`}>Download Excel</a></div>
    </div>
    <p><a className="button secondary" href={`/api/v1/groups/${id}/cycles/${cycleId}/meetings/${meetingId}/reports/pdf`}>Download PDF</a></p>
    <GroupNav id={id}/>
    <p><Link href={`/groups/${id}/reports/cycles/${cycleId}`}>← Cycle {report.metadata.cycleNumber} report</Link></p>
    <MeetingReportView report={report}/>
  </>;
}
