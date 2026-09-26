import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { manualGoogleMeetSchema } from "@/modules/meetings/meeting.schemas";
import { createGoogleMeetForMeeting, setManualGoogleMeetForMeeting } from "@/modules/google-integration/google-meet.service";
import { ok, fail } from "@/lib/errors/response";

export async function POST(_request, { params }) {
  try {
    const { id, meetingId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "meeting.create", GROUP_ACTION.MEETING_OPERATE);
    return ok(await createGoogleMeetForMeeting(id, meetingId, user));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request, { params }) {
  try {
    const { id, meetingId } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "meeting.create", GROUP_ACTION.MEETING_OPERATE);
    const data = parse(manualGoogleMeetSchema, await request.json());
    return ok(await setManualGoogleMeetForMeeting(id, meetingId, data.virtualMeetingUrl, user));
  } catch (error) {
    return fail(error);
  }
}
