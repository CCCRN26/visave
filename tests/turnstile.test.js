import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AppError, AuthorizationError } from "../src/lib/errors/index.js";
import { getTurnstileClientConfig, TURNSTILE_ACTIONS, verifyTurnstileToken } from "../src/lib/security/turnstile.js";
import { login } from "../src/modules/auth/auth.service.js";
import { assistedPasswordResetWithTurnstile } from "../src/modules/auth/assisted-password-reset.service.js";

const read = (file) => fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const enabledEnvironment = {
  TURNSTILE_ENABLED: "true",
  NEXT_PUBLIC_TURNSTILE_SITE_KEY: "public-site-key",
  TURNSTILE_SECRET_KEY: "server-secret",
  TURNSTILE_ALLOWED_HOSTNAMES: "localhost, staging.visave.example",
};
const ALWAYS_PASS_TEST_SECRET = "1x0000000000000000000000000000000AA";
const ALWAYS_FAIL_TEST_SECRET = "2x0000000000000000000000000000000AA";
const TOKEN_SPENT_TEST_SECRET = "3x0000000000000000000000000000000AA";
const dummyEnvironment = {
  ...enabledEnvironment,
  NODE_ENV: "development",
  TURNSTILE_TEST_MODE: "true",
  TURNSTILE_SECRET_KEY: ALWAYS_PASS_TEST_SECRET,
};
const response = (value, ok = true) => ({ ok, json: async () => value });
const validResult = { success: true, action: "login", hostname: "localhost" };
const dummySuccess = { success: true, hostname: "example.com", action: undefined, "error-codes": [] };

test("disabled mode preserves protected actions without calling Siteverify", async () => {
  let called = false;
  const result = await verifyTurnstileToken({ token: undefined, expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
    environment: { TURNSTILE_ENABLED: "false" },
    fetchImpl: async () => { called = true; },
  });
  assert.deepEqual(result, { enabled: false, verified: false, skipped: true });
  assert.equal(called, false);
  assert.deepEqual(getTurnstileClientConfig({ TURNSTILE_ENABLED: "false", NEXT_PUBLIC_TURNSTILE_SITE_KEY: "unused" }), { enabled: false, siteKey: "" });
});

test("enabled mode rejects a missing token before calling Siteverify", async () => {
  let called = false;
  await assert.rejects(
    verifyTurnstileToken({ token: " ", expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment: enabledEnvironment, fetchImpl: async () => { called = true; } }),
    (error) => error.code === "TURNSTILE_REQUIRED" && error.statusCode === 400,
  );
  assert.equal(called, false);
});

test("successful Siteverify response permits the exact action and allowed hostname", async () => {
  let request;
  const result = await verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
    environment: enabledEnvironment,
    fetchImpl: async (url, options) => { request = { url, options }; return response(validResult); },
  });
  assert.deepEqual(result, { enabled: true, verified: true, action: "login", hostname: "localhost" });
  assert.equal(request.url, "https://challenges.cloudflare.com/turnstile/v0/siteverify");
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.get("secret"), "server-secret");
  assert.equal(request.options.body.get("response"), "provider-token");
  assert.equal(request.options.body.has("remoteip"), false);
});

test("strict mode requires the exact action for login and assisted reset", async () => {
  for (const expectedAction of Object.values(TURNSTILE_ACTIONS)) {
    const result = await verifyTurnstileToken({ token: "provider-token", expectedAction }, {
      environment: enabledEnvironment,
      fetchImpl: async () => response({ success: true, action: expectedAction, hostname: "localhost" }),
    });
    assert.equal(result.action, expectedAction);
  }
});

test("strict mode rejects success=false, wrong hostname, missing action, and wrong action as invalid", async () => {
  const cases = [
    { success: false, action: "login", hostname: "localhost" },
    { success: true, action: "login", hostname: "evil.example" },
    { success: true, hostname: "localhost" },
    { success: true, action: "login" },
    { success: true, action: "assisted_password_reset", hostname: "localhost" },
  ];
  for (const providerResult of cases) {
    await assert.rejects(
      verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment: enabledEnvironment, fetchImpl: async () => response(providerResult) }),
      (error) => error.code === "TURNSTILE_INVALID",
    );
  }
});

test("explicit non-production test mode accepts Cloudflare's synthetic always-pass response", async () => {
  const result = await verifyTurnstileToken({ token: "XXXX.DUMMY.TOKEN.XXXX", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
    environment: dummyEnvironment,
    fetchImpl: async () => response(dummySuccess),
  });
  assert.deepEqual(result, { enabled: true, verified: true, action: undefined, hostname: "example.com" });
});

test("dummy test mode never converts success=false into success", async () => {
  for (const secret of [ALWAYS_PASS_TEST_SECRET, ALWAYS_FAIL_TEST_SECRET, TOKEN_SPENT_TEST_SECRET]) {
    await assert.rejects(
      verifyTurnstileToken({ token: "XXXX.DUMMY.TOKEN.XXXX", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
        environment: { ...dummyEnvironment, TURNSTILE_SECRET_KEY: secret },
        fetchImpl: async () => response({ success: false, "error-codes": ["invalid-input-response"] }),
      }),
      (error) => error.code === "TURNSTILE_INVALID" && error.statusCode === 400,
    );
  }
});

test("unknown secrets cannot enable dummy test mode", async () => {
  let called = false;
  await assert.rejects(
    verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
      environment: { ...enabledEnvironment, NODE_ENV: "development", TURNSTILE_TEST_MODE: "true" },
      fetchImpl: async () => { called = true; return response(dummySuccess); },
    }),
    (error) => error.code === "TURNSTILE_CONFIGURATION_ERROR" && error.statusCode === 503,
  );
  assert.equal(called, false);
});

test("production never relaxes hostname or action validation", async () => {
  for (const providerResult of [
    { success: true, action: "login", hostname: "example.com" },
    { success: true, hostname: "localhost" },
  ]) {
    await assert.rejects(
      verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
        environment: { ...dummyEnvironment, NODE_ENV: "production" },
        fetchImpl: async () => response(providerResult),
      }),
      (error) => error.code === "TURNSTILE_INVALID" && error.statusCode === 400,
    );
  }
});

test("missing or false test mode keeps dummy credentials on strict validation", async () => {
  for (const TURNSTILE_TEST_MODE of [undefined, "false"]) {
    await assert.rejects(
      verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
        environment: { ...dummyEnvironment, TURNSTILE_TEST_MODE },
        fetchImpl: async () => response(dummySuccess),
      }),
      (error) => error.code === "TURNSTILE_INVALID" && error.statusCode === 400,
    );
  }
});

test("malformed, non-JSON, and non-OK Siteverify responses fail closed", async () => {
  const providers = [
    async () => response({ action: "login", hostname: "localhost" }),
    async () => ({ ok: true, json: async () => { throw new Error("bad json"); } }),
    async () => response({}, false),
  ];
  for (const fetchImpl of providers) {
    await assert.rejects(
      verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment: enabledEnvironment, fetchImpl }),
      (error) => error.code === "TURNSTILE_UNAVAILABLE" && error.statusCode === 503,
    );
  }
});

test("network failure and timeout fail closed", async () => {
  await assert.rejects(
    verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment: enabledEnvironment, fetchImpl: async () => { throw new Error("offline"); } }),
    (error) => error.code === "TURNSTILE_UNAVAILABLE",
  );
  const neverCompletes = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })), { once: true });
  });
  await assert.rejects(
    verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment: enabledEnvironment, fetchImpl: neverCompletes, timeoutMs: 5 }),
    (error) => error.code === "TURNSTILE_UNAVAILABLE",
  );
});

test("logical verification failures are invalid while provider failures are unavailable", async () => {
  await assert.rejects(
    verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
      environment: enabledEnvironment,
      fetchImpl: async () => response({ success: true, hostname: "localhost" }),
    }),
    (error) => error.code === "TURNSTILE_INVALID" && error.statusCode === 400,
  );
  await assert.rejects(
    verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, {
      environment: enabledEnvironment,
      fetchImpl: async () => { throw new Error("offline"); },
    }),
    (error) => error.code === "TURNSTILE_UNAVAILABLE" && error.statusCode === 503,
  );
});

test("missing secret, empty hostnames, and invalid enabled value fail closed", async () => {
  for (const environment of [
    { ...enabledEnvironment, TURNSTILE_SECRET_KEY: "" },
    { ...enabledEnvironment, TURNSTILE_ALLOWED_HOSTNAMES: " , " },
    { ...enabledEnvironment, TURNSTILE_ENABLED: "tru" },
    { ...dummyEnvironment, TURNSTILE_TEST_MODE: "TRUE" },
  ]) {
    await assert.rejects(
      verifyTurnstileToken({ token: "provider-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment, fetchImpl: async () => response(validResult) }),
      (error) => error.code === "TURNSTILE_CONFIGURATION_ERROR" && error.statusCode === 503,
    );
  }
});

test("oversized tokens are rejected before the provider boundary", async () => {
  let called = false;
  await assert.rejects(
    verifyTurnstileToken({ token: "x".repeat(2049), expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment: enabledEnvironment, fetchImpl: async () => { called = true; } }),
    (error) => error.code === "TURNSTILE_INVALID",
  );
  assert.equal(called, false);
});

test("client configuration exposes only enabled state and public site key, never the secret", () => {
  const config = getTurnstileClientConfig(enabledEnvironment);
  assert.deepEqual(config, { enabled: true, siteKey: "public-site-key" });
  assert.doesNotMatch(JSON.stringify(config), /server-secret/);
  assert.doesNotMatch(read("src/components/turnstile-widget.js"), /TURNSTILE_SECRET_KEY|server-secret/);
});

test("Turnstile verification does not log tokens or provider credentials", async () => {
  const calls = [];
  const originalError = console.error;
  const originalLog = console.log;
  console.error = (...values) => calls.push(values);
  console.log = (...values) => calls.push(values);
  try {
    await assert.rejects(
      verifyTurnstileToken({ token: "never-log-this-token", expectedAction: TURNSTILE_ACTIONS.LOGIN }, { environment: enabledEnvironment, fetchImpl: async () => { throw new Error("offline"); } }),
      (error) => error.code === "TURNSTILE_UNAVAILABLE",
    );
  } finally {
    console.error = originalError;
    console.log = originalLog;
  }
  assert.deepEqual(calls, []);
  assert.doesNotMatch(read("src/lib/security/turnstile.js"), /console\./);
});

function loginClient(user) {
  const calls = [];
  return {
    calls,
    query: async (sql, params = []) => {
      calls.push({ sql, params });
      if (sql.startsWith("SELECT id,organization_id")) return { rows: user ? [{ ...user }] : [] };
      if (sql.startsWith("INSERT INTO user_sessions")) return { rows: [{ id: "session-1" }] };
      return { rows: [] };
    },
  };
}

test("valid Turnstile plus valid credentials preserves login, session, and forced-change state", async () => {
  const client = loginClient({ id: "user-1", organization_id: "org-1", email: "user@example.org", status: "ACTIVE", password_hash: "hash", must_change_password: true });
  let verification;
  const result = await login({ email: "user@example.org", password: "correct-password", turnstileToken: "login-token", ip: null, userAgent: null }, {
    verifyTurnstile: async (value) => { verification = value; },
    passwordTools: { compare: async () => true },
    transaction: async (work) => work(client),
  });
  assert.deepEqual(verification, { token: "login-token", expectedAction: "login" });
  assert.equal(result.user.must_change_password, true);
  assert.ok(result.token);
  assert.ok(client.calls.some((call) => call.sql.startsWith("INSERT INTO user_sessions")));
});

test("missing or invalid Turnstile blocks login before credential and session work", async () => {
  for (const code of ["TURNSTILE_REQUIRED", "TURNSTILE_INVALID"]) {
    let transactionCalled = false;
    await assert.rejects(
      login({ email: "user@example.org", password: "correct-password" }, {
        verifyTurnstile: async () => { throw new AppError("Verification failed", code, 400); },
        transaction: async () => { transactionCalled = true; },
      }),
      (error) => error.code === code,
    );
    assert.equal(transactionCalled, false);
  }
});

test("Turnstile passing does not change normal invalid-credential failure", async () => {
  const client = loginClient({ id: "user-1", organization_id: "org-1", email: "user@example.org", status: "ACTIVE", password_hash: "hash", must_change_password: false });
  await assert.rejects(
    login({ email: "user@example.org", password: "wrong", turnstileToken: "login-token" }, {
      verifyTurnstile: async () => {},
      passwordTools: { compare: async () => false },
      transaction: async (work) => work(client),
    }),
    (error) => error.code === "AUTHENTICATION_REQUIRED",
  );
  assert.ok(!client.calls.some((call) => call.sql.startsWith("INSERT INTO user_sessions")));
});

test("assisted reset requires its own action and preserves authorization failures", async () => {
  const actor = { id: "manager-1", organization_id: "org-1", roles: ["PROJECT_ADMIN"] };
  const seen = [];
  const result = await assistedPasswordResetWithTurnstile(actor, "target-1", { reason: "Verified in person", turnstileToken: "reset-token" }, {
    verifyTurnstile: async (value) => seen.push(value),
    reset: async (...values) => { seen.push(values); return { temporaryPassword: "not-sent-to-turnstile" }; },
  });
  assert.equal(result.temporaryPassword, "not-sent-to-turnstile");
  assert.deepEqual(seen[0], { token: "reset-token", expectedAction: "assisted_password_reset" });
  assert.doesNotMatch(JSON.stringify(seen[0]), /Verified in person|target-1|temporaryPassword/);

  await assert.rejects(
    assistedPasswordResetWithTurnstile(actor, "cross-scope-target", { reason: "Reason", turnstileToken: "valid-token" }, {
      verifyTurnstile: async () => {},
      reset: async () => { throw new AuthorizationError("USER_SCOPE_DENIED"); },
    }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("assisted reset accepts explicit local dummy mode without weakening authorization", async () => {
  const actor = { id: "manager-1", organization_id: "org-1", roles: ["PROJECT_ADMIN"] };
  const result = await assistedPasswordResetWithTurnstile(actor, "target-1", { reason: "Verified in person", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }, {
    verifyTurnstile: (input) => verifyTurnstileToken(input, {
      environment: dummyEnvironment,
      fetchImpl: async () => response(dummySuccess),
    }),
    reset: async () => ({ temporaryPassword: "not-sent-to-turnstile" }),
  });
  assert.equal(result.temporaryPassword, "not-sent-to-turnstile");

  await assert.rejects(
    assistedPasswordResetWithTurnstile(actor, "cross-scope-target", { reason: "Reason", turnstileToken: "XXXX.DUMMY.TOKEN.XXXX" }, {
      verifyTurnstile: (input) => verifyTurnstileToken(input, {
        environment: dummyEnvironment,
        fetchImpl: async () => response(dummySuccess),
      }),
      reset: async () => { throw new AuthorizationError("USER_SCOPE_DENIED"); },
    }),
    (error) => error.code === "FORBIDDEN",
  );
});

test("client widgets use explicit managed configuration, reset on failures, and never send sensitive cData", () => {
  const widget = read("src/components/turnstile-widget.js");
  const loginForm = read("src/components/login-form.js");
  const resetForm = read("src/components/assisted-password-reset.js");
  assert.match(widget, /render=explicit/);
  assert.match(widget, /theme: "auto"/);
  assert.match(widget, /size: "flexible"/);
  assert.match(widget, /appearance: "interaction-only"/);
  assert.match(widget, /"expired-callback"/);
  assert.match(widget, /"timeout-callback"/);
  assert.match(widget, /window\.turnstile\.reset/);
  assert.doesNotMatch(widget, /cData|cdata/);
  assert.match(loginForm, /resetVerification\(\)/);
  assert.match(loginForm, /turnstile\.enabled && !turnstileToken/);
  assert.match(loginForm, /json\.error\?\.code\?\.startsWith\("TURNSTILE_"\)/);
  assert.match(loginForm, /if \(token\) setTurnstileError\(""\)/);
  assert.match(loginForm, /onTokenChange=\{handleTokenChange\}/);
  assert.match(resetForm, /widgetRef\.current\?\.reset\(\)/);
  assert.match(resetForm, /action="assisted_password_reset"/);
});

test("CSP makes only the required Turnstile origin additions", () => {
  const config = read("next.config.mjs");
  assert.match(config, /script-src[^\n]+https:\/\/challenges\.cloudflare\.com/);
  assert.match(config, /frame-src 'self' https:\/\/challenges\.cloudflare\.com/);
  assert.match(config, /frame-ancestors 'none'/);
});

