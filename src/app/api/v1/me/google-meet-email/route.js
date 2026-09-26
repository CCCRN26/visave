import { requireAuth } from "@/lib/auth/session";
import { parse } from "@/lib/validation/parse";
import { ok, fail } from "@/lib/errors/response";
import { googleMeetIdentitySchema } from "@/modules/users/google-meet-identity.schemas";
import { getGoogleMeetIdentity, updateGoogleMeetIdentity } from "@/modules/users/google-meet-identity.service";

export async function GET() {
  try {
    const user = await requireAuth();
    return ok(await getGoogleMeetIdentity(user));
  } catch (error) {
    return fail(error);
  }
}

export async function PATCH(request) {
  try {
    const user = await requireAuth();
    const data = parse(googleMeetIdentitySchema, await request.json());
    return ok(await updateGoogleMeetIdentity(user, data.googleMeetEmail));
  } catch (error) {
    return fail(error);
  }
}
