import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getMeeting } from "@/modules/meetings/meeting.service";
import { listLoans } from "@/modules/loans/loan.service";
import GroupNav from "@/components/group-nav";
import MeetingMode from "@/components/meeting-mode";
import MeetingLoans from "@/components/meeting-loans";
import { formatDate } from "@/lib/utils/date";
import Link from "next/link";
import { canAccessCycleReports } from "@/modules/reports/cycle-report.service";

export default async function Meeting({ params }) {
  const { id, meetingId } = await params;
  const user = await requireAuth();
  const actor = await requireGroupRouteAction(user, id, "meeting.view", GROUP_ACTION.MEETING_VIEW);
  const canReport = canAccessCycleReports(user, actor);
  const capabilities = {
    attendance: canGroupAction(user, actor, GROUP_ACTION.ATTENDANCE_OPERATE),
    financial: canGroupAction(user, actor, GROUP_ACTION.FINANCIAL_OPERATE),
    reverse: canGroupAction(user, actor, GROUP_ACTION.FINANCIAL_REVERSE),
    repay: canGroupAction(user, actor, GROUP_ACTION.LOAN_REPAY),
    loanRequest: canGroupAction(user, actor, GROUP_ACTION.LOAN_REQUEST),
    loanDecide: canGroupAction(user, actor, GROUP_ACTION.LOAN_DECIDE),
    loanDisburse: canGroupAction(user, actor, GROUP_ACTION.LOAN_DISBURSE),
    reconcile: canGroupAction(user, actor, GROUP_ACTION.RECONCILIATION_OPERATE),
    close: canGroupAction(user, actor, GROUP_ACTION.MEETING_OPERATE),
  };
  const [data, loans] = await Promise.all([getMeeting(id, meetingId), listLoans(id)]);
  return <>
    <h1>Meeting #{data.meeting.meeting_number}</h1>
    <p className="muted">{formatDate(data.meeting.meeting_date)} · {data.meeting.meeting_code} · <span className="badge">{data.meeting.status}</span></p>
    {actor.operation_mode === "MEMBER_MANAGED" && <div className="panel" style={{padding:14,marginBottom:14}}><b>Member-Managed Group</b><br/><span className="muted">Operating as {actor.officer_position?.replaceAll("_", " ") || (actor.is_assigned_facilitator ? "Facilitator / Supervisor" : "Authorized viewer")}</span></div>}
    <GroupNav id={id}/>
    {canReport && <p><Link href={`/groups/${id}/reports/cycles/${data.meeting.cycle_id}/meetings/${meetingId}`}>View Meeting Report</Link></p>}
    {data.meeting.is_latest_valid && <div className="closeout-entry"><div><strong>Is this the final meeting of the cycle?</strong><span>Use the guided workspace to complete Share-out and prepare the next cycle.</span></div><Link className="button" href={`/groups/${id}/cycles/${data.meeting.cycle_id}/closeout`}>Start Cycle Close-out</Link></div>}
    <MeetingMode groupId={id} initial={data} capabilities={capabilities}/>
    <MeetingLoans groupId={id} meetingId={meetingId} meetingDate={data.meeting.meeting_date} availableFund={data.summary.currentSavingsLoan} attendance={data.attendance} data={loans} open={data.meeting.status === "OPEN"} canRequest={capabilities.loanRequest} canDecide={capabilities.loanDecide} canDisburse={capabilities.loanDisburse} canRepay={capabilities.repay}/>
  </>;
}
