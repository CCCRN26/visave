import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getCloseoutWorkspace } from "@/modules/shareout/closeout.service";
import GroupNav from "@/components/group-nav";
import CycleCloseoutWorkspace from "@/components/cycle-closeout-workspace";
import { formatCurrency } from "@/lib/utils/money";
import { formatDate } from "@/lib/utils/date";

function nextCalendarDate(value) {
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day + 1));
  return date.toISOString().slice(0, 10);
}

export default async function CycleCloseoutPage({ params }) {
  const { id, cycleId } = await params;
  const user = await requireAuth();
  const actor = await requireGroupRouteAction(user, id, "shareout.view", GROUP_ACTION.SHAREOUT_VIEW);
  const state = await getCloseoutWorkspace(id, cycleId);
  state.recommendedNextStart = nextCalendarDate(state.cycle.expected_end_date);
  const capabilities = {
    finishMeeting: canGroupAction(user, actor, GROUP_ACTION.MEETING_OPERATE),
    prepare: canGroupAction(user, actor, GROUP_ACTION.SHAREOUT_PREPARE), approve: canGroupAction(user, actor, GROUP_ACTION.SHAREOUT_APPROVE),
    payout: canGroupAction(user, actor, GROUP_ACTION.SHAREOUT_PAYOUT), complete: canGroupAction(user, actor, GROUP_ACTION.SHAREOUT_COMPLETE),
    operate: canGroupAction(user, actor, GROUP_ACTION.SHAREOUT_OPERATE), refreshReconciliation: canGroupAction(user, actor, GROUP_ACTION.RECONCILIATION_OPERATE),
    close: canGroupAction(user, actor, GROUP_ACTION.CYCLE_CLOSE), cycleManage: canGroupAction(user, actor, GROUP_ACTION.CYCLE_MANAGE), participationManage: canGroupAction(user, actor, GROUP_ACTION.CYCLE_PARTICIPATION_MANAGE),
  };
  const financial = state.readiness.state || {};
  return <><div className="closeout-heading"><div><p className="eyebrow">Guided cycle completion</p><h1>Cycle {state.cycle.cycle_number} Close-out</h1><p>{state.cycle.group_name} · {formatDate(state.cycle.start_date)} – {formatDate(state.cycle.expected_end_date)}</p></div></div><GroupNav id={id}/><section className="closeout-summary" aria-label="Close-out summary"><div><span>Final meeting</span><strong>{state.finalMeeting ? `Meeting #${state.finalMeeting.meeting_number} · ${formatDate(state.finalMeeting.meeting_date)}` : "Not recorded"}</strong></div><div><span>Members</span><strong>{state.finalMeeting?.member_count ?? financial.included_members ?? 0}</strong></div><div><span>Outstanding loans</span><strong>{financial.outstanding_loans ?? state.transition.closure.proof.outstanding_loans ?? 0}</strong></div><div><span>Share-out</span><strong>{state.shareout ? state.shareout.shareout.status.replaceAll("_", " ") : "Not started"}</strong></div><div><span>Social Fund</span><strong>{formatCurrency(state.transition.closure.proof.social_cash || financial.social_cash || "0.00")}</strong></div></section><CycleCloseoutWorkspace groupId={id} state={state} capabilities={capabilities}/></>;
}
