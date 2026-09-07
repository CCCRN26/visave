import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { deactivateFacilitatorSchema } from "@/modules/facilitators/facilitator.schemas";
import { deactivateFacilitator } from "@/modules/facilitators/facilitator.service";
export async function POST(request, { params }) { try { const { id } = await params; const actor = await requireAuth(); requirePermission(actor, "facilitator.deactivate"); return ok(await deactivateFacilitator(id, parse(deactivateFacilitatorSchema, await request.json()), actor)); } catch (error) { return fail(error); } }
