import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getMeeting } from "@/modules/meetings/meeting.service";
import { isGoogleMeetUrl } from "@/modules/meetings/meeting-url";
import { getGoogleConnectionStatus } from "@/modules/google-integration/google-connection.service";
import { getGoogleMeetIdentity } from "@/modules/users/google-meet-identity.service";
import { listLoans } from "@/modules/loans/loan.service";
import GroupNav from "@/components/group-nav";
import MeetingMode from "@/components/meeting-mode";
import MeetingLoans from "@/components/meeting-loans";
import GoogleMeetSetupPanel from "@/components/google-meet-setup-panel";
import { formatDate } from "@/lib/utils/date";
import Link from "next/link";
import { canAccessCycleReports } from "@/modules/reports/cycle-report.service";

const meetingModeLabels = {
  PHYSICAL: "Physical",
  VIRTUAL: "Virtual",
  HYBRID: "Hybrid",
};

const cohostNotices = {
  MISSING_EMAIL: "Google Meet was created. Add a Google Meet email to your profile to be assigned automatically as a co-host.",
  FAILED: "Google Meet was created, but the meeting operator could not be added as a co-host. The organizer can add a co-host manually.",
  PENDING: "Preparing Google Meet…",
};

export default async function Meeting({ params, searchParams }) {
  const { id, meetingId } = await params;
  const pageQuery = (await searchParams) || {};
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
  const meetingMode = data.meeting.meeting_mode || "PHYSICAL";
  const canJoinMeeting =
    data.meeting.status === "OPEN" &&
    ["VIRTUAL", "HYBRID"].includes(meetingMode) &&
    isGoogleMeetUrl(data.meeting.virtual_meeting_url);
  const virtualMeetingEnded =
    data.meeting.status !== "OPEN" &&
    ["VIRTUAL", "HYBRID"].includes(meetingMode);
  const canConfigureGoogleMeet =
    capabilities.close &&
    data.meeting.status === "OPEN" &&
    ["VIRTUAL", "HYBRID"].includes(meetingMode);
  const [googleStatus, operatorIdentity] = canConfigureGoogleMeet
    ? await Promise.all([
      getGoogleConnectionStatus(user.organization_id),
      getGoogleMeetIdentity(user),
    ])
    : [{ connected: false }, { googleMeetEmail: null }];

  return <>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
      <div>
        <h1>Meeting #{data.meeting.meeting_number}</h1>
        <p className="muted">{formatDate(data.meeting.meeting_date)} · {data.meeting.meeting_code} · <span className="badge">{data.meeting.status}</span></p>
        <p><strong>Meeting Type:</strong> {meetingModeLabels[meetingMode] || "Physical"}</p>
      </div>
      {canJoinMeeting && !(canConfigureGoogleMeet && data.meeting.google_meet_space_name) && <a className="button" href={data.meeting.virtual_meeting_url} target="_blank" rel="noopener noreferrer">Join Meeting</a>}
      {virtualMeetingEnded && <strong>Virtual meeting ended</strong>}
    </div>
    {canConfigureGoogleMeet && <GoogleMeetSetupPanel
      groupId={id}
      meetingId={meetingId}
      connected={googleStatus.connected}
      hasMeetLink={canJoinMeeting}
      googleCreated={Boolean(data.meeting.google_meet_space_name)}
      operatorEmailConfigured={Boolean(operatorIdentity.googleMeetEmail)}
      joinUrl={canJoinMeeting ? data.meeting.virtual_meeting_url : null}
      initialCohostStatus={pageQuery.googleMeetCohost || "READY"}
      initialNotice={cohostNotices[pageQuery.googleMeetCohost] || ""}
    />}
    {actor.operation_mode === "MEMBER_MANAGED" && <div className="panel" style={{padding:14,marginBottom:14}}><b>Member-Managed Group</b><br/><span className="muted">Operating as {actor.officer_position?.replaceAll("_", " ") || (actor.is_assigned_facilitator ? "Facilitator / Supervisor" : "Authorized viewer")}</span></div>}
    <GroupNav id={id}/>
    {canReport && <p><Link href={`/groups/${id}/reports/cycles/${data.meeting.cycle_id}/meetings/${meetingId}`}>View Meeting Report</Link></p>}
    {data.meeting.is_latest_valid && <div className="closeout-entry"><div><strong>Is this the final meeting of the cycle?</strong><span>Use the guided workspace to complete Share-out and prepare the next cycle.</span></div><Link className="button" href={`/groups/${id}/cycles/${data.meeting.cycle_id}/closeout`}>Start Cycle Close-out</Link></div>}
    <MeetingMode groupId={id} initial={data} capabilities={capabilities}/>
    <MeetingLoans groupId={id} meetingId={meetingId} meetingDate={data.meeting.meeting_date} availableFund={data.summary.currentSavingsLoan} attendance={data.attendance} data={loans} open={data.meeting.status === "OPEN"} canRequest={capabilities.loanRequest} canDecide={capabilities.loanDecide} canDisburse={capabilities.loanDisburse} canRepay={capabilities.repay}/>
  </>;
}
