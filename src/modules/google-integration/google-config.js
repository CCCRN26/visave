import { AppError } from "@/lib/errors";

export const GOOGLE_MEET_CREATE_SCOPE = "https://www.googleapis.com/auth/meetings.space.created";
export const GOOGLE_OAUTH_SCOPES = ["openid", "email", GOOGLE_MEET_CREATE_SCOPE];

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new AppError(
      "Google Meet integration is not configured. Ask a Visave administrator to complete the Google settings.",
      "GOOGLE_CONFIGURATION_MISSING",
      503,
    );
  }
  return value;
}

export function getGoogleOAuthConfig() {
  return {
    clientId: required("GOOGLE_CLIENT_ID"),
    clientSecret: required("GOOGLE_CLIENT_SECRET"),
    redirectUri: required("GOOGLE_REDIRECT_URI"),
  };
}

export function getGoogleMeetAccessType() {
  const accessType = (process.env.GOOGLE_MEET_ACCESS_TYPE?.trim() || "TRUSTED").toUpperCase();
  if (!["TRUSTED", "RESTRICTED"].includes(accessType)) {
    throw new AppError(
      "Google Meet access must be configured as TRUSTED or RESTRICTED. OPEN access is not allowed.",
      "GOOGLE_MEET_ACCESS_TYPE_INVALID",
      503,
    );
  }
  return accessType;
}
