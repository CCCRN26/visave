import { requireAuth } from "@/lib/auth/session";
import { ok, fail } from "@/lib/errors/response";
import { listMyMeetings } from "@/modules/member-meetings/member-meeting.service";

export async function GET() {
  try {
    const user = await requireAuth();
    return ok(await listMyMeetings(user));
  } catch (error) {
    return fail(error);
  }
}
