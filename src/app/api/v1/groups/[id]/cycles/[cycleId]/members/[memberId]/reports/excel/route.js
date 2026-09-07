import { requireAuth } from "@/lib/auth/session";
import { fail } from "@/lib/errors/response";
import { buildMemberStatementExcel, memberStatementFilename } from "@/modules/reports/member-statement-excel";
import { getMemberStatement } from "@/modules/reports/member-statement.service";
export async function GET(_request, { params }) { try { const { id, cycleId, memberId } = await params; const report = await getMemberStatement(await requireAuth(), id, cycleId, memberId, "export"); const workbook = await buildMemberStatementExcel(report); return new Response(new Uint8Array(workbook), { headers: { "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "Content-Disposition": `attachment; filename="${memberStatementFilename(report)}"`, "Cache-Control": "private, no-store" } }); } catch (error) { return fail(error); } }
