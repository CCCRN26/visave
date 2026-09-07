import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { getMemberManagedReadiness } from "@/modules/member-managed/member-managed.service";
import { ok, fail } from "@/lib/errors/response";
export async function GET(_request,{params}) { try { const {id}=await params,user=await requireAuth();
  await requireGroupRouteAction(user,id,"group_operation_mode.view",GROUP_ACTION.OPERATION_MODE_VIEW);
  return ok(await getMemberManagedReadiness(id,user)); } catch(error) { return fail(error); } }
