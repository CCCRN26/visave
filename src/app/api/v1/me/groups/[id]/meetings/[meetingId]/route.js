import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/errors/response";
import { getMyMeeting } from "@/modules/member-meetings/member-meeting.service";

export async function GET(_request, { params }) {
  try {
    const { id, meetingId } = await params;
    const user = await requireAuth();
    return ok(await getMyMeeting(id, meetingId, user));
  } catch (error) {
    return fail(error);
  }
}
