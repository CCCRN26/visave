import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { ok, fail } from "@/lib/errors/response";
import { closureReadiness } from "@/modules/shareout/shareout.service";

export async function GET(_request, { params }) {
  try {
    const { id, cycleId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "shareout.view", GROUP_ACTION.SHAREOUT_VIEW);
    return ok(await closureReadiness(id, cycleId));
  } catch (error) {
    return fail(error);
  }
}
