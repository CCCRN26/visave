import { requireAuth } from "@/lib/auth/session";
import { requireGroupRouteAction, GROUP_ACTION } from "@/modules/group-access/group-access.service";
import { parse } from "@/lib/validation/parse";
import { openMeetingSchema } from "@/modules/meetings/meeting.schemas";
import { getMeetings, openMeeting } from "@/modules/meetings/meeting.service";
import { createGoogleMeetForMeeting } from "@/modules/google-integration/google-meet.service";
import { ok, fail } from "@/lib/errors/response";

export async function GET(_request, { params }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "meeting.view", GROUP_ACTION.MEETING_VIEW);
    return ok(await getMeetings(id));
  } catch (error) {
    return fail(error);
  }
}

export async function POST(request, { params }) {
  try {
    const { id } = await params;
    const user = await requireAuth();
    await requireGroupRouteAction(user, id, "meeting.create", GROUP_ACTION.MEETING_OPERATE);
    const data = parse(openMeetingSchema, await request.json());
    const meeting = await openMeeting(id, data, user);
    if (data.meetSetup !== "AUTOMATIC") return ok(meeting, 201);
    try {
      const result = await createGoogleMeetForMeeting(id, meeting.id, user);
      return ok({
        ...result.meeting,
        googleMeetCohostAssignment: result.cohostAssignment || null,
        googleMeetWarning: result.cohostWarning || null,
      }, 201);
    } catch (error) {
      console.error("Google Meet automatic creation failed", {
        organizationId: user.organization_id,
        meetingId: meeting.id,
        errorCategory: error?.code || "GOOGLE_UNKNOWN",
      });
      return ok({
        ...meeting,
        googleMeetWarning: error?.statusCode
          ? error.message
          : "Google Meet could not be created. Retry from the meeting page or add an existing Meet link.",
      }, 201);
    }
  } catch (error) {
    return fail(error);
  }
}
