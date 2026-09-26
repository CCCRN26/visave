import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth/session";
import { requirePermission } from "@/lib/permissions";
import { AppError, ValidationError } from "@/lib/errors";
import { fail } from "@/lib/errors/response";
import { GOOGLE_MEET_CREATE_SCOPE, GOOGLE_OAUTH_SCOPES } from "@/modules/google-integration/google-config";
import { connectGoogleAccount } from "@/modules/google-integration/google-connection.service";
import { exchangeGoogleAuthorizationCode, getGoogleAccount } from "@/modules/google-integration/google-oauth";
import { GOOGLE_OAUTH_STATE_COOKIE, googleOAuthStateCookieOptions, validateGoogleOAuthState } from "@/modules/google-integration/google-oauth-state";

function clearState(response) {
  response.cookies.set(GOOGLE_OAUTH_STATE_COOKIE, "", { ...googleOAuthStateCookieOptions(), maxAge: 0 });
  return response;
}

export async function GET(request) {
  try {
    const user = await requireAuth();
    requirePermission(user, "organization.manage");
    const state = request.nextUrl.searchParams.get("state");
    const cookieValue = (await cookies()).get(GOOGLE_OAUTH_STATE_COOKIE)?.value;
    validateGoogleOAuthState(cookieValue, state, user);
    const providerError = request.nextUrl.searchParams.get("error");
    if (providerError) throw new AppError("Google connection was cancelled or denied.", "GOOGLE_CONNECTION_DENIED", 400);
    const code = request.nextUrl.searchParams.get("code");
    if (!code) throw new ValidationError("Google authorization code is missing. Start the connection again.");

    const tokens = await exchangeGoogleAuthorizationCode(code);
    const scopes = tokens.scope?.split(/\s+/).filter(Boolean) || GOOGLE_OAUTH_SCOPES;
    if (!scopes.includes(GOOGLE_MEET_CREATE_SCOPE)) {
      throw new AppError("Google Meet permission was not granted. Connect again and approve the requested permission.", "GOOGLE_SCOPE_MISSING", 400);
    }
    const account = await getGoogleAccount(tokens.access_token);
    await connectGoogleAccount(user, {
      email: account.email,
      refreshToken: tokens.refresh_token,
      scopes,
    });
    return clearState(NextResponse.redirect(new URL("/settings?google=connected", request.url)));
  } catch (error) {
    return clearState(fail(error));
  }
}
