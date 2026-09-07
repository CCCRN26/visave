import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { assignGroupsSchema } from "@/modules/facilitators/facilitator.schemas";
import { assignGroups } from "@/modules/facilitators/facilitator.service";
export async function POST(request, { params }) { try { const { id } = await params; const actor = await requireAuth(); requirePermission(actor, "facilitator.assign_groups"); return ok(await assignGroups(id, parse(assignGroupsSchema, await request.json()), actor)); } catch (error) { return fail(error); } }
