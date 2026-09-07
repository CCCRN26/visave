import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { prepareShareoutSchema } from "@/modules/shareout/shareout.schemas";
import { meetingCycleId, prepare } from "@/modules/shareout/shareout.service";

export async function POST(request, { params }) {
  try {
    const { id, meetingId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "shareout.prepare", GROUP_ACTION.SHAREOUT_PREPARE);
    parse(prepareShareoutSchema, await request.json());
    const cycleId = await meetingCycleId(id, meetingId);
    return ok(await prepare(id, cycleId, meetingId, user), 201);
  } catch (error) {
    return fail(error);
  }
}
