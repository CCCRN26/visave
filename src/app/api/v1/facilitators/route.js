import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { createFacilitatorSchema, facilitatorListSchema } from "@/modules/facilitators/facilitator.schemas";
import { createFacilitator, listFacilitators } from "@/modules/facilitators/facilitator.service";
export async function GET(request) { try { const actor = await requireAuth(); requirePermission(actor, "facilitator.view"); return ok(await listFacilitators(actor, parse(facilitatorListSchema, Object.fromEntries(request.nextUrl.searchParams)))); } catch (error) { return fail(error); } }
export async function POST(request) { try { const actor = await requireAuth(); requirePermission(actor, "facilitator.create"); return ok(await createFacilitator(parse(createFacilitatorSchema, await request.json()), actor), 201); } catch (error) { return fail(error); } }
