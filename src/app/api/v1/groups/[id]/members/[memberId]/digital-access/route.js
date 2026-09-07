import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { digitalAccessSchema } from "@/modules/member-managed/member-managed.schemas";
import { enableDigitalAccess, disableDigitalAccess } from "@/modules/member-managed/member-managed.service";
import { ok, fail } from "@/lib/errors/response";

export async function POST(request, { params }) {
  try {
    const { id, memberId } = await params; const user = await requireAuth();
    await requireGroupRouteAction(user, id, "member_access.manage", GROUP_ACTION.DIGITAL_ACCESS_MANAGE);
    return ok(await enableDigitalAccess(id, memberId, parse(digitalAccessSchema, await request.json()), user), 201);
  } catch (error) { return fail(error); }
}
export async function DELETE(_request, { params }) {
  try {
    const { id, memberId } = await params; const user = await requireAuth();
    await requireGroupRouteAction(user, id, "member_access.manage", GROUP_ACTION.DIGITAL_ACCESS_MANAGE);
    return ok(await disableDigitalAccess(id, memberId, user));
  } catch (error) { return fail(error); }
}
