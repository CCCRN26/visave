import { requireAuth } from "@/lib/auth/session";
import { parse } from "@/lib/validation/parse";
import { archiveGroupSchema } from "@/modules/common/schemas";
import { archiveGroup } from "@/modules/groups/group-archive.service";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { ok, fail } from "@/lib/errors/response";

export async function POST(request, { params }) {
  try {
    const { id } = await params, user = await requireAuth();
    await requireGroupRouteAction(user, id, "group.archive", GROUP_ACTION.GROUP_ARCHIVE);
    return ok(await archiveGroup(id, parse(archiveGroupSchema, await request.json()), user));
  } catch (error) { return fail(error); }
}
