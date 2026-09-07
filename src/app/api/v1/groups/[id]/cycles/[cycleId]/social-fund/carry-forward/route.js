import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { carryForwardSchema } from "@/modules/shareout/shareout.schemas";
import { carryForward } from "@/modules/shareout/shareout.service";

export async function POST(request, { params }) {
  try {
    const { id, cycleId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "social_fund.carry_forward", GROUP_ACTION.SHAREOUT_OPERATE);
    return ok(await carryForward(id, cycleId, parse(carryForwardSchema, await request.json()), user), 201);
  } catch (error) {
    return fail(error);
  }
}
