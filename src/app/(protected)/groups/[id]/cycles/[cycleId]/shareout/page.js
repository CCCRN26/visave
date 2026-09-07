import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, canGroupAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import GroupNav from "@/components/group-nav";
import ShareoutPanel from "@/components/shareout-panel";
import { cycleReadiness, cycleTransitionState, getShareout } from "@/modules/shareout/shareout.service";
import { getFinalReconciliationRefresh } from "@/modules/meetings/meeting.service";
import Link from "next/link";

export default async function ShareoutPage({ params }) {
  const { id, cycleId } = await params;
  const user = await requireAuth();
  const actor = await requireGroupRouteAction(user, id, "shareout.view", GROUP_ACTION.SHAREOUT_VIEW);
  const [readiness, detail, transition, finalReconciliation] = await Promise.all([
    cycleReadiness(id, cycleId),
    getShareout(id, cycleId),
    cycleTransitionState(id,cycleId),
    getFinalReconciliationRefresh(id,cycleId),
  ]);
  const capabilities={prepare:canGroupAction(user,actor,GROUP_ACTION.SHAREOUT_PREPARE),approve:canGroupAction(user,actor,GROUP_ACTION.SHAREOUT_APPROVE),payout:canGroupAction(user,actor,GROUP_ACTION.SHAREOUT_PAYOUT),complete:canGroupAction(user,actor,GROUP_ACTION.SHAREOUT_COMPLETE),close:canGroupAction(user,actor,GROUP_ACTION.CYCLE_CLOSE),cycleManage:canGroupAction(user,actor,GROUP_ACTION.CYCLE_MANAGE),operate:canGroupAction(user,actor,GROUP_ACTION.SHAREOUT_OPERATE),refreshReconciliation:canGroupAction(user,actor,GROUP_ACTION.RECONCILIATION_OPERATE)};
  return (
    <>
      <h1>Share-out and Cycle Closure</h1>
      <GroupNav id={id} />
      <p><Link className="button" href={`/groups/${id}/cycles/${cycleId}/closeout`}>Continue Cycle Close-out</Link></p>
      <ShareoutPanel groupId={id} cycleId={cycleId} initialReadiness={readiness} initialDetail={detail} transition={transition} finalReconciliation={finalReconciliation} capabilities={capabilities} />
    </>
  );
}
