import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { payoutSchema } from "@/modules/shareout/shareout.schemas";
import { meetingCycleId, payout } from "@/modules/shareout/shareout.service";

export async function POST(request, { params }) {
  try {
    const { id, meetingId, shareoutId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "shareout.payout", GROUP_ACTION.SHAREOUT_PAYOUT);
    const data = parse(payoutSchema, await request.json());
    const cycleId = await meetingCycleId(id, meetingId);
    return ok(await payout(id, cycleId, meetingId, shareoutId, data, user), 201);
  } catch (error) {
    return fail(error);
  }
}
