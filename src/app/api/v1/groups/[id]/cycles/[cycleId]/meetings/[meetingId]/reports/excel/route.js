import { requireAuth } from "@/lib/auth/session";
import { fail } from "@/lib/errors/response";
import { getMeetingReport } from "@/modules/reports/meeting-report.service";
import { buildMeetingReportExcel, meetingReportFilename } from "@/modules/reports/meeting-report-excel";

export async function GET(_request, { params }) {
  try {
    const { id, cycleId, meetingId } = await params;
    const user = await requireAuth();
    const report = await getMeetingReport(user, id, cycleId, meetingId, "export");
    const workbook = await buildMeetingReportExcel(report);
    return new Response(new Uint8Array(workbook), {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${meetingReportFilename(report)}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    return fail(error);
  }
}
