import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { closeCycleSchema } from "@/modules/shareout/shareout.schemas";
import { activateNextCycle } from "@/modules/shareout/shareout.service";

export async function POST(request, { params }) {
  try {
    const { id, cycleId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "group.activate", GROUP_ACTION.CYCLE_MANAGE);
    parse(closeCycleSchema, await request.json());
    return ok(await activateNextCycle(id, cycleId, user));
  } catch (error) {
    return fail(error);
  }
}
