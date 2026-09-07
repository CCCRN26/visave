import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { emptyFacilitatorSchema } from "@/modules/facilitators/facilitator.schemas";
import { activateFacilitator } from "@/modules/facilitators/facilitator.service";
export async function POST(request, { params }) { try { const { id } = await params; const actor = await requireAuth(); requirePermission(actor, "facilitator.activate"); parse(emptyFacilitatorSchema, await request.json()); return ok(await activateFacilitator(id, actor)); } catch (error) { return fail(error); } }
