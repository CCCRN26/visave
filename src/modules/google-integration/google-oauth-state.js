import crypto from "node:crypto";
import { ValidationError } from "@/lib/errors";

export const GOOGLE_OAUTH_STATE_COOKIE = "visave_google_oauth_state";
const STATE_TTL_MS = 10 * 60 * 1000;

export function createGoogleOAuthState(user, now = Date.now()) {
  const state = crypto.randomBytes(32).toString("base64url");
  const cookieValue = Buffer.from(JSON.stringify({
    state,
    expiresAt: now + STATE_TTL_MS,
    userId: user.id,
    organizationId: user.organization_id,
    sessionId: user.session_id,
  })).toString("base64url");
  return { state, cookieValue };
}

export function googleOAuthStateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/v1/integrations/google",
    maxAge: STATE_TTL_MS / 1000,
  };
}

export function validateGoogleOAuthState(cookieValue, returnedState, user, now = Date.now()) {
  if (!cookieValue || !returnedState) throw new ValidationError("Google connection state is missing. Start the connection again.");
  let stored;
  try {
    stored = JSON.parse(Buffer.from(cookieValue, "base64url").toString("utf8"));
  } catch {
    throw new ValidationError("Google connection state is invalid. Start the connection again.");
  }
  if (!stored?.state || !stored.expiresAt || stored.expiresAt < now) {
    throw new ValidationError("Google connection state has expired. Start the connection again.");
  }
  if (
    stored.userId !== user.id ||
    stored.organizationId !== user.organization_id ||
    stored.sessionId !== user.session_id
  ) {
    throw new ValidationError("Google connection state belongs to a different session. Start the connection again.");
  }
  const expected = Buffer.from(stored.state);
  const actual = Buffer.from(returnedState);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new ValidationError("Google connection state does not match. Start the connection again.");
  }
}
