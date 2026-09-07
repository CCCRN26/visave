import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { closeCycleSchema } from "@/modules/shareout/shareout.schemas";
import { closeCycle } from "@/modules/shareout/shareout.service";

export async function POST(request, { params }) {
  try {
    const { id, cycleId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "cycle.close", GROUP_ACTION.CYCLE_CLOSE);
    parse(closeCycleSchema, await request.json());
    return ok(await closeCycle(id, cycleId, user));
  } catch (error) {
    return fail(error);
  }
}
