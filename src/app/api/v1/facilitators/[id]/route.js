import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { updateFacilitatorSchema } from "@/modules/facilitators/facilitator.schemas";
import { getFacilitator, updateFacilitator } from "@/modules/facilitators/facilitator.service";
export async function GET(_request, { params }) { try { const { id } = await params; const actor = await requireAuth(); requirePermission(actor, "facilitator.view"); return ok(await getFacilitator(id, actor)); } catch (error) { return fail(error); } }
export async function PATCH(request, { params }) { try { const { id } = await params; const actor = await requireAuth(); requirePermission(actor, "facilitator.update"); return ok(await updateFacilitator(id, parse(updateFacilitatorSchema, await request.json()), actor)); } catch (error) { return fail(error); } }
