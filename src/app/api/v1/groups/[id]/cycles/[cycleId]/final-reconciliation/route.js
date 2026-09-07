import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { reconciliationSchema } from "@/modules/meetings/meeting.schemas";
import { getFinalReconciliationRefresh, refreshFinalReconciliation } from "@/modules/meetings/meeting.service";
import { ok, fail } from "@/lib/errors/response";

export async function GET(_request, { params }) {
  try {
    const { id, cycleId } = await params, user = await requireAuth();
    await requireGroupRouteAction(user, id, "meeting.view", GROUP_ACTION.RECONCILIATION_VIEW);
    return ok(await getFinalReconciliationRefresh(id, cycleId));
  } catch (error) { return fail(error); }
}

export async function POST(request, { params }) {
  try {
    const { id, cycleId } = await params, user = await requireAuth();
    await requireGroupRouteAction(user, id, "meeting.manage", GROUP_ACTION.RECONCILIATION_OPERATE);
    return ok(await refreshFinalReconciliation(id, cycleId, parse(reconciliationSchema, await request.json()), user), 201);
  } catch (error) { return fail(error); }
}
