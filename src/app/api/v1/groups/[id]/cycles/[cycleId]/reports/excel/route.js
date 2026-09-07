import { requireAuth } from "@/lib/auth/session";
import { fail } from "@/lib/errors/response";
import { getCycleReport } from "@/modules/reports/cycle-report.service";
import { buildCycleReportExcel, cycleReportFilename } from "@/modules/reports/cycle-report-excel";

export async function GET(_request, { params }) {
  try {
    const { id, cycleId } = await params;
    const user = await requireAuth();
    const report = await getCycleReport(user, id, cycleId, "export");
    const workbook = await buildCycleReportExcel(report);
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${cycleReportFilename(report)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
