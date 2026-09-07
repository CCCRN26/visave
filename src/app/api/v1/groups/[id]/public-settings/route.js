import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { publicSettingsSchema } from "@/modules/membership-requests/membership-request.schemas";
import { updatePublicSettings } from "@/modules/membership-requests/membership-request.service";
import { ok, fail } from "@/lib/errors/response";
export async function PATCH(request,{params}) {
  try {
    const user=await requireAuth(),{id}=await params;
    await requireGroupRouteAction(user,id,"group_public.manage",GROUP_ACTION.GROUP_MANAGE);
    return ok(await updatePublicSettings(id,parse(publicSettingsSchema,await request.json()),user));
  } catch(error) { return fail(error); }
}
