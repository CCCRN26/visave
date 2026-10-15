import { AppError } from "@/lib/errors";

const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const TOKEN_MAX_LENGTH = 2048;
const DEFAULT_TIMEOUT_MS = 5000;
const TURNSTILE_TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

export const TURNSTILE_ACTIONS = Object.freeze({
  LOGIN: "login",
  ASSISTED_PASSWORD_RESET: "assisted_password_reset",
});

function configurationError() {
  return new AppError("Human verification is temporarily unavailable. Please try again.", "TURNSTILE_CONFIGURATION_ERROR", 503);
}

function enabledState(environment) {
  const value = (environment.TURNSTILE_ENABLED || "").trim().toLowerCase();
  if (!value || value === "false") return false;
  if (value === "true") return true;
  throw configurationError();
}

function allowedHostnames(environment) {
  return [...new Set((environment.TURNSTILE_ALLOWED_HOSTNAMES || "").split(",").map((hostname) => hostname.trim().toLowerCase()).filter(Boolean))];
}

function dummyTestModeEnabled(environment, secret) {
  const value = environment.TURNSTILE_TEST_MODE || "";
  if (!value || value === "false") return false;
  if (value !== "true" || !TURNSTILE_TEST_SECRETS.has(secret)) throw configurationError();
  return environment.NODE_ENV !== "production";
}

export function getTurnstileClientConfig(environment = process.env) {
  let enabled;
  try { enabled = enabledState(environment); } catch { enabled = true; }
  return { enabled, siteKey: enabled ? (environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "").trim() : "" };
}

export async function verifyTurnstileToken(
  { token, expectedAction },
  { environment = process.env, fetchImpl = globalThis.fetch, timeoutMs = DEFAULT_TIMEOUT_MS } = {},
) {
  if (!enabledState(environment)) return { enabled: false, verified: false, skipped: true };

  const secret = (environment.TURNSTILE_SECRET_KEY || "").trim();
  const hostnames = allowedHostnames(environment);
  if (!secret || hostnames.length === 0 || !Object.values(TURNSTILE_ACTIONS).includes(expectedAction)) throw configurationError();
  const dummyTestMode = dummyTestModeEnabled(environment, secret);

  const responseToken = typeof token === "string" ? token.trim() : "";
  if (!responseToken) throw new AppError("Complete human verification and try again.", "TURNSTILE_REQUIRED", 400);
  if (responseToken.length > TOKEN_MAX_LENGTH) throw new AppError("Human verification was unsuccessful. Please try again.", "TURNSTILE_INVALID", 400);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  let providerResponse;
  try {
    providerResponse = await fetchImpl(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: responseToken }),
      signal: controller.signal,
    });
  } catch {
    throw new AppError("Human verification is temporarily unavailable. Please try again.", "TURNSTILE_UNAVAILABLE", 503);
  } finally {
    clearTimeout(timeout);
  }

  if (!providerResponse?.ok) throw new AppError("Human verification is temporarily unavailable. Please try again.", "TURNSTILE_UNAVAILABLE", 503);

  let result;
  try { result = await providerResponse.json(); } catch {
    throw new AppError("Human verification is temporarily unavailable. Please try again.", "TURNSTILE_UNAVAILABLE", 503);
  }
  if (!result || typeof result !== "object" || typeof result.success !== "boolean") {
    throw new AppError("Human verification is temporarily unavailable. Please try again.", "TURNSTILE_UNAVAILABLE", 503);
  }
  if (!result.success) throw new AppError("Human verification was unsuccessful. Please try again.", "TURNSTILE_INVALID", 400);
  if (!dummyTestMode && (
    typeof result.action !== "string"
    || typeof result.hostname !== "string"
    || result.action !== expectedAction
    || !hostnames.includes(result.hostname.trim().toLowerCase())
  )) {
    throw new AppError("Human verification was unsuccessful. Please try again.", "TURNSTILE_INVALID", 400);
  }

  return { enabled: true, verified: true, action: result.action, hostname: result.hostname };
}

