import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { payoutReversalSchema } from "@/modules/shareout/shareout.schemas";
import { meetingCycleId, reversePayout } from "@/modules/shareout/shareout.service";

export async function POST(request, { params }) {
  try {
    const { id, meetingId, shareoutId, payoutId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "shareout.reverse", GROUP_ACTION.SHAREOUT_PAYOUT);
    const data = parse(payoutReversalSchema, await request.json());
    const cycleId = await meetingCycleId(id, meetingId);
    return ok(await reversePayout(id, cycleId, meetingId, shareoutId, payoutId, data, user), 201);
  } catch (error) {
    return fail(error);
  }
}
