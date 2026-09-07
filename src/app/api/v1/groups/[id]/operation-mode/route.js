import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { operationModeSchema } from "@/modules/member-managed/member-managed.schemas";
import { changeOperationMode } from "@/modules/member-managed/member-managed.service";
import { ok, fail } from "@/lib/errors/response";
export async function POST(request,{params}) { try { const {id}=await params,user=await requireAuth();
  await requireGroupRouteAction(user,id,"group_operation_mode.manage",GROUP_ACTION.OPERATION_MODE_MANAGE);
  return ok(await changeOperationMode(id,parse(operationModeSchema,await request.json()),user)); } catch(error) { return fail(error); } }
