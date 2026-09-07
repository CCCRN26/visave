import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { ok, fail } from "@/lib/errors/response";
import { getFacilitator } from "@/modules/facilitators/facilitator.service";
export async function GET(_request, { params }) { try { const { id } = await params; const actor = await requireAuth(); requirePermission(actor, "facilitator.view"); return ok((await getFacilitator(id, actor)).groups); } catch (error) { return fail(error); } }
