import { AppError } from "@/lib/errors";
import { GOOGLE_OAUTH_SCOPES, getGoogleOAuthConfig } from "./google-config";
import { googleJsonRequest } from "./google-http";

const AUTHORIZATION_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo";
const REVOCATION_URL = "https://oauth2.googleapis.com/revoke";

export function buildGoogleAuthorizationUrl(state) {
  const { clientId, redirectUri } = getGoogleOAuthConfig();
  const url = new URL(AUTHORIZATION_URL);
  url.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    access_type: "offline",
    prompt: "consent select_account",
    include_granted_scopes: "true",
    scope: GOOGLE_OAUTH_SCOPES.join(" "),
    state,
  }).toString();
  return url.toString();
}

export async function exchangeGoogleAuthorizationCode(code, { fetchImpl = globalThis.fetch } = {}) {
  const { clientId, clientSecret, redirectUri } = getGoogleOAuthConfig();
  const result = await googleJsonRequest(
    TOKEN_URL,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
    },
    { fetchImpl },
  );
  if (!result.access_token || !result.refresh_token) {
    throw new AppError(
      "Google did not return offline access. Reconnect and approve the requested permission.",
      "GOOGLE_REFRESH_TOKEN_MISSING",
      400,
    );
  }
  return result;
}

export async function getGoogleAccount(accessToken, { fetchImpl = globalThis.fetch } = {}) {
  const account = await googleJsonRequest(
    USERINFO_URL,
    { headers: { authorization: `Bearer ${accessToken}` } },
    { fetchImpl },
  );
  if (!account.email || account.email_verified === false) {
    throw new AppError("Google did not provide a verified account email.", "GOOGLE_EMAIL_UNAVAILABLE", 400);
  }
  return { email: account.email.toLowerCase() };
}

export async function refreshGoogleAccessToken(refreshToken, { fetchImpl = globalThis.fetch } = {}) {
  const { clientId, clientSecret } = getGoogleOAuthConfig();
  let result;
  try {
    result = await googleJsonRequest(
      TOKEN_URL,
      {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          refresh_token: refreshToken,
          grant_type: "refresh_token",
        }),
      },
      { fetchImpl },
    );
  } catch (error) {
    if (["GOOGLE_REQUEST_REJECTED", "GOOGLE_AUTHORIZATION_REQUIRED"].includes(error?.code)) {
      throw new AppError(
        "Google authorization has expired or was revoked. Ask a Visave administrator to reconnect Google Meet.",
        "GOOGLE_AUTHORIZATION_REQUIRED",
        503,
      );
    }
    throw error;
  }
  if (!result.access_token) {
    throw new AppError(
      "Google authorization could not be refreshed. Ask a Visave administrator to reconnect Google Meet.",
      "GOOGLE_AUTHORIZATION_REQUIRED",
      503,
    );
  }
  return result.access_token;
}

export async function revokeGoogleToken(token, { fetchImpl = globalThis.fetch } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  try {
    const response = await fetchImpl(REVOCATION_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      signal: controller.signal,
    });
    return response.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}
