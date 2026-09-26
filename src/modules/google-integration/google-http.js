import { AppError } from "@/lib/errors";

export async function googleJsonRequest(url, options = {}, context = {}) {
  const { fetchImpl = globalThis.fetch, timeoutMs = 10000, accessType, acceptedStatuses = [] } = context;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetchImpl(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new AppError("Google did not respond in time. Try again.", "GOOGLE_TIMEOUT", 503);
    }
    throw new AppError("Google is temporarily unavailable. Try again.", "GOOGLE_UNAVAILABLE", 503);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok && acceptedStatuses.includes(response.status)) {
    return { acceptedStatus: response.status };
  }

  if (!response.ok) {
    if (accessType === "RESTRICTED" && [400, 403].includes(response.status)) {
      throw new AppError(
        "The connected Google account or policy does not support RESTRICTED Meet access. Use TRUSTED or ask the Google Workspace administrator to update the account policy.",
        "GOOGLE_RESTRICTED_ACCESS_UNSUPPORTED",
        409,
      );
    }
    if ([401, 403].includes(response.status)) {
      throw new AppError(
        "Google authorization has expired or was revoked. Ask a Visave administrator to reconnect Google Meet.",
        "GOOGLE_AUTHORIZATION_REQUIRED",
        503,
      );
    }
    if (response.status === 429) {
      throw new AppError("Google Meet is temporarily busy. Try again shortly.", "GOOGLE_RATE_LIMITED", 503);
    }
    if (response.status >= 500) {
      throw new AppError("Google Meet is temporarily unavailable. Try again.", "GOOGLE_UNAVAILABLE", 503);
    }
    throw new AppError("Google rejected the request. Check the Google Meet configuration.", "GOOGLE_REQUEST_REJECTED", 502);
  }

  try {
    return await response.json();
  } catch {
    throw new AppError("Google returned an invalid response. Try again.", "GOOGLE_INVALID_RESPONSE", 502);
  }
}
