import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { buildGoogleAuthorizationUrl } from "@/modules/google-integration/google-oauth";
import { createGoogleOAuthState, GOOGLE_OAUTH_STATE_COOKIE, googleOAuthStateCookieOptions } from "@/modules/google-integration/google-oauth-state";
import { fail } from "@/lib/errors/response";

export async function GET() {
  try {
    const user = await requireAuth();
    requirePermission(user, "organization.manage");
    const { state, cookieValue } = createGoogleOAuthState(user);
    const response = NextResponse.redirect(buildGoogleAuthorizationUrl(state));
    response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, cookieValue, googleOAuthStateCookieOptions());
    return response;
  } catch (error) {
    return fail(error);
  }
}
