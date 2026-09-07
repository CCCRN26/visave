import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { closeCycleSchema } from "@/modules/shareout/shareout.schemas";
import { complete } from "@/modules/shareout/shareout.service";

export async function POST(request, { params }) {
  try {
    const { id, cycleId, shareoutId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "shareout.approve", GROUP_ACTION.SHAREOUT_COMPLETE);
    parse(closeCycleSchema, await request.json());
    return ok(await complete(id, cycleId, shareoutId, user));
  } catch (error) {
    return fail(error);
  }
}
