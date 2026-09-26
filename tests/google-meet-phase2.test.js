import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { requirePermission } from "../src/lib/permissions/check.js";
import { encryptGoogleRefreshToken, decryptGoogleRefreshToken } from "../src/lib/security/google-token-encryption.js";
import { openMeetingSchema } from "../src/modules/meetings/meeting.schemas.js";
import { googleMeetIdentitySchema } from "../src/modules/users/google-meet-identity.schemas.js";
import { buildGoogleAuthorizationUrl } from "../src/modules/google-integration/google-oauth.js";
import { createGoogleOAuthState, validateGoogleOAuthState } from "../src/modules/google-integration/google-oauth-state.js";
import { createGoogleMeetForMeeting, createGoogleMeetSpace, setManualGoogleMeetForMeeting } from "../src/modules/google-integration/google-meet.service.js";
import { canGroupAction, GROUP_ACTION } from "../src/modules/group-access/group-access.service.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const originalEnvironment = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
  GOOGLE_MEET_ACCESS_TYPE: process.env.GOOGLE_MEET_ACCESS_TYPE,
};

test.before(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_REDIRECT_URI = "https://visave.example/api/v1/integrations/google/callback";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  delete process.env.GOOGLE_MEET_ACCESS_TYPE;
});

test.after(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

function fakePool(meetingOverrides = {}, { connected = true, operatorEmail = null } = {}) {
  const encrypted = encryptGoogleRefreshToken("refresh-token-value");
  const state = {
    meeting: {
      id: "meeting-1",
      organization_id: "organization-1",
      group_id: "group-1",
      status: "OPEN",
      meeting_mode: "VIRTUAL",
      virtual_meeting_url: null,
      google_meet_space_name: null,
      ...meetingOverrides,
    },
    connection: connected ? {
      id: "connection-1",
      organization_id: "organization-1",
      encrypted_refresh_token: encrypted.encryptedRefreshToken,
      token_iv: encrypted.tokenIv,
      token_auth_tag: encrypted.tokenAuthTag,
      encryption_key_version: encrypted.encryptionKeyVersion,
      revoked_at: null,
    } : null,
    operatorEmail,
    queries: [],
    released: false,
  };
  const client = {
    async query(text, params = []) {
      state.queries.push({ text, params });
      if (text.includes("FROM vsla_meetings")) return { rows: [{ ...state.meeting }] };
      if (text.includes("FROM organization_google_oauth_connections")) {
        return { rows: state.connection ? [{ ...state.connection }] : [] };
      }
      if (text.includes("SELECT google_meet_email") && text.includes("FROM users")) {
        return { rows: [{ google_meet_email: state.operatorEmail }] };
      }
      if (text.includes("UPDATE vsla_meetings") && text.includes("google_meet_space_name=$5")) {
        state.meeting.virtual_meeting_url = params[3];
        state.meeting.google_meet_space_name = params[4];
        return { rows: [{ ...state.meeting }] };
      }
      if (text.includes("UPDATE vsla_meetings") && text.includes("virtual_meeting_url=$4")) {
        state.meeting.virtual_meeting_url = params[3];
        return { rows: [{ ...state.meeting }] };
      }
      return { rows: [] };
    },
    release() { state.released = true; },
  };
  return { state, pool: { async connect() { return client; } } };
}

function successfulGoogleFetch(record) {
  return async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      record.refreshCalls += 1;
      return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
    }
    if (url === "https://meet.googleapis.com/v2/spaces") {
      record.spaceCalls += 1;
      record.spaceRequest = JSON.parse(options.body);
      return new Response(JSON.stringify({
        name: "spaces/space-123",
        meetingUri: "https://meet.google.com/abc-defg-hij",
      }), { status: 200 });
    }
    if (url === "https://meet.googleapis.com/v2/spaces/space-123/members") {
      record.memberCalls = (record.memberCalls || 0) + 1;
      record.memberRequest = JSON.parse(options.body);
      return new Response(JSON.stringify({ name: "spaces/space-123/members/member-1" }), { status: 200 });
    }
    if (url.startsWith("https://meet.googleapis.com/v2/spaces/space-123/members?")) {
      record.verifyCalls = (record.verifyCalls || 0) + 1;
      return new Response(JSON.stringify({ members: [{ email: record.operatorEmail, role: "COHOST" }] }), { status: 200 });
    }
    throw new Error(`Unexpected URL: ${url}`);
  };
}

test("only organization.manage users can initiate central Google OAuth", () => {
  assert.throws(() => requirePermission({ permissions: [] }, "organization.manage"));
  assert.doesNotThrow(() => requirePermission({ permissions: ["organization.manage"] }, "organization.manage"));
  const route = read("../src/app/api/v1/integrations/google/connect/route.js");
  assert.match(route, /requirePermission\(user, "organization\.manage"\)/);

  const url = new URL(buildGoogleAuthorizationUrl("state-value"));
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("state"), "state-value");
  assert.match(url.searchParams.get("scope"), /meetings\.space\.created/);
  assert.match(url.searchParams.get("scope"), /openid/);
  assert.match(url.searchParams.get("scope"), /email/);
});

test("OAuth state is random, matched in constant time, and expires", () => {
  const user = { id: "user-1", organization_id: "organization-1", session_id: "session-1" };
  const first = createGoogleOAuthState(user, 1000);
  const second = createGoogleOAuthState(user, 1000);
  assert.notEqual(first.state, second.state);
  assert.doesNotThrow(() => validateGoogleOAuthState(first.cookieValue, first.state, user, 2000));
  assert.throws(() => validateGoogleOAuthState(first.cookieValue, second.state, user, 2000), /does not match/);
  assert.throws(() => validateGoogleOAuthState(first.cookieValue, first.state, { ...user, session_id: "session-2" }, 2000), /different session/);
  assert.throws(() => validateGoogleOAuthState(first.cookieValue, first.state, user, 1000 + 11 * 60 * 1000), /expired/);
});

test("refresh tokens use AES-256-GCM and plaintext is not persisted", () => {
  const encrypted = encryptGoogleRefreshToken("highly-sensitive-refresh-token");
  assert.notEqual(encrypted.encryptedRefreshToken, "highly-sensitive-refresh-token");
  assert.equal(decryptGoogleRefreshToken({
    encrypted_refresh_token: encrypted.encryptedRefreshToken,
    token_iv: encrypted.tokenIv,
    token_auth_tag: encrypted.tokenAuthTag,
    encryption_key_version: encrypted.encryptionKeyVersion,
  }), "highly-sensitive-refresh-token");
  const service = read("../src/modules/google-integration/google-connection.service.js");
  assert.match(service, /encrypted\.encryptedRefreshToken/);
  assert.doesNotMatch(service, /data\.refreshToken,\s*data\.email/);
});

test("Virtual and Hybrid automatic creation store meetingUri and stable Space.name using TRUSTED", async () => {
  for (const meetingMode of ["VIRTUAL", "HYBRID"]) {
    const fake = fakePool({ meeting_mode: meetingMode });
    const record = { refreshCalls: 0, spaceCalls: 0, spaceRequest: null };
    const result = await createGoogleMeetForMeeting("group-1", "meeting-1", { id: "user-1", organization_id: "organization-1" }, {
      pool: fake.pool,
      fetchImpl: successfulGoogleFetch(record),
    });
    assert.equal(result.created, true);
    assert.equal(fake.state.meeting.virtual_meeting_url, "https://meet.google.com/abc-defg-hij");
    assert.equal(fake.state.meeting.google_meet_space_name, "spaces/space-123");
    assert.equal(fake.state.meeting.status, "OPEN");
    assert.equal(record.spaceRequest.config.accessType, "TRUSTED");
    assert.equal(record.spaceRequest.config.entryPointAccess, "ALL");
  }
});

test("automatic creation adds the authenticated operator email as COHOST", async () => {
  const fake = fakePool({}, { operatorEmail: "facilitator@example.org" });
  const record = { refreshCalls: 0, spaceCalls: 0, memberCalls: 0, operatorEmail: "facilitator@example.org" };
  const result = await createGoogleMeetForMeeting(
    "group-1",
    "meeting-1",
    { id: "facilitator-user", organization_id: "organization-1", roles: ["FACILITATOR"] },
    { pool: fake.pool, fetchImpl: successfulGoogleFetch(record), wait: async () => {} },
  );
  assert.equal(result.cohostAssignment, "READY");
  assert.equal(record.memberCalls, 1);
  assert.deepEqual(record.memberRequest, { email: "facilitator@example.org", role: "COHOST" });
  const identityQuery = fake.state.queries.find(({ text }) => text.includes("SELECT google_meet_email"));
  assert.deepEqual(identityQuery.params, ["facilitator-user", "organization-1"]);
});

test("Program Assisted facilitator and Member Managed operator both use the actual authenticated operator", async () => {
  for (const actor of [
    { id: "program-facilitator", roles: ["FACILITATOR"], email: "agent@example.org" },
    { id: "member-chairperson", roles: ["VSLA_MEMBER"], email: "chair@example.org" },
  ]) {
    const fake = fakePool({}, { operatorEmail: actor.email });
    const record = { refreshCalls: 0, spaceCalls: 0, memberCalls: 0, operatorEmail: actor.email };
    await createGoogleMeetForMeeting(
      "group-1",
      "meeting-1",
      { id: actor.id, organization_id: "organization-1", roles: actor.roles },
      { pool: fake.pool, fetchImpl: successfulGoogleFetch(record), wait: async () => {} },
    );
    assert.equal(record.memberRequest.email, actor.email);
    const identityQuery = fake.state.queries.find(({ text }) => text.includes("SELECT google_meet_email"));
    assert.equal(identityQuery.params[0], actor.id);
  }

  const baseContext = {
    operation_mode: "MEMBER_MANAGED",
    linked_member_id: "member-1",
    member_status: "ACTIVE",
    active_cycle_id: "cycle-1",
    cycle_membership_id: "membership-1",
    cycle_status: "ACTIVE",
    has_program_scope: false,
    is_assigned_facilitator: false,
    is_active_facilitator: false,
    has_facilitator_scope: false,
  };
  assert.equal(canGroupAction(
    { roles: ["VSLA_MEMBER"] },
    { ...baseContext, officer_position: "CHAIRPERSON", isChairperson: true, isRecordKeeper: false },
    GROUP_ACTION.MEETING_OPERATE,
  ), true);
  assert.equal(canGroupAction(
    { roles: ["VSLA_MEMBER"] },
    { ...baseContext, officer_position: null, isChairperson: false, isRecordKeeper: false },
    GROUP_ACTION.MEETING_OPERATE,
  ), false);
});

test("missing operator Google Meet email does not block Meet creation or call members.create", async () => {
  const fake = fakePool();
  const record = { refreshCalls: 0, spaceCalls: 0, memberCalls: 0 };
  const result = await createGoogleMeetForMeeting(
    "group-1",
    "meeting-1",
    { id: "user-1", organization_id: "organization-1" },
    { pool: fake.pool, fetchImpl: successfulGoogleFetch(record) },
  );
  assert.equal(result.cohostAssignment, "MISSING_EMAIL");
  assert.match(result.cohostWarning, /Add a Google Meet email to your profile/);
  assert.equal(record.memberCalls, 0);
  assert.equal(fake.state.meeting.status, "OPEN");
  assert.equal(fake.state.meeting.google_meet_space_name, "spaces/space-123");
});

test("co-host API failure leaves the created Meet persisted and meeting OPEN", async () => {
  const fake = fakePool({}, { operatorEmail: "operator@example.org" });
  const fetchImpl = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
    }
    if (url === "https://meet.googleapis.com/v2/spaces") {
      return new Response(JSON.stringify({
        name: "spaces/space-123",
        meetingUri: "https://meet.google.com/abc-defg-hij",
      }), { status: 200 });
    }
    if (url.endsWith("/members")) return new Response("unavailable", { status: 503 });
    throw new Error(`Unexpected URL: ${url} ${options?.method || "GET"}`);
  };
  const result = await createGoogleMeetForMeeting(
    "group-1",
    "meeting-1",
    { id: "user-1", organization_id: "organization-1" },
    { pool: fake.pool, fetchImpl },
  );
  assert.equal(result.cohostAssignment, "FAILED");
  assert.match(result.cohostWarning, /organizer can add a co-host manually/);
  assert.equal(fake.state.meeting.status, "OPEN");
  assert.equal(fake.state.meeting.virtual_meeting_url, "https://meet.google.com/abc-defg-hij");
  assert.equal(fake.state.meeting.google_meet_space_name, "spaces/space-123");
});

test("co-host retry reuses the existing Meet and treats an existing membership as success", async () => {
  const fake = fakePool({
    virtual_meeting_url: "https://meet.google.com/abc-defg-hij",
    google_meet_space_name: "spaces/space-123",
  }, { operatorEmail: "operator@example.org" });
  const record = { refreshCalls: 0, spaceCalls: 0, memberCalls: 0 };
  const fetchImpl = async (url, options) => {
    if (url === "https://oauth2.googleapis.com/token") {
      record.refreshCalls += 1;
      return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
    }
    if (url.endsWith("/members")) {
      record.memberCalls += 1;
      record.memberRequest = JSON.parse(options.body);
      return new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), { status: 409 });
    }
    if (url.includes("/members?")) {
      return new Response(JSON.stringify({ members: [{ email: "operator@example.org", role: "COHOST" }] }), { status: 200 });
    }
    if (url === "https://meet.googleapis.com/v2/spaces") record.spaceCalls += 1;
    throw new Error(`Unexpected URL: ${url}`);
  };
  const result = await createGoogleMeetForMeeting(
    "group-1",
    "meeting-1",
    { id: "user-1", organization_id: "organization-1" },
    { pool: fake.pool, fetchImpl, wait: async () => {} },
  );
  assert.equal(result.created, false);
  assert.equal(result.cohostAssignment, "ALREADY_ASSIGNED");
  assert.equal(record.spaceCalls, 0);
  assert.equal(record.memberCalls, 1);
  assert.deepEqual(record.memberRequest, { email: "operator@example.org", role: "COHOST" });
});

test("duplicate automatic retries return existing meeting and create only one Google space", async () => {
  const fake = fakePool();
  const record = { refreshCalls: 0, spaceCalls: 0, spaceRequest: null };
  const options = { pool: fake.pool, fetchImpl: successfulGoogleFetch(record) };
  const user = { id: "user-1", organization_id: "organization-1" };
  await createGoogleMeetForMeeting("group-1", "meeting-1", user, options);
  const retry = await createGoogleMeetForMeeting("group-1", "meeting-1", user, options);
  assert.equal(retry.created, false);
  assert.equal(retry.source, "GOOGLE");
  assert.equal(record.spaceCalls, 1);
  assert.ok(fake.state.queries.some(({ text }) => text.includes("pg_advisory_lock")));
});

test("Google failure leaves the Visave meeting OPEN and retryable", async () => {
  const fake = fakePool();
  const fetchImpl = async (url) => {
    if (url === "https://oauth2.googleapis.com/token") {
      return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
    }
    return new Response("unavailable", { status: 503 });
  };
  await assert.rejects(
    createGoogleMeetForMeeting("group-1", "meeting-1", { id: "user-1", organization_id: "organization-1" }, { pool: fake.pool, fetchImpl }),
    (error) => error.code === "GOOGLE_UNAVAILABLE",
  );
  assert.equal(fake.state.meeting.status, "OPEN");
  assert.equal(fake.state.meeting.virtual_meeting_url, null);
  assert.equal(fake.state.meeting.google_meet_space_name, null);
  assert.equal(fake.state.queries.some(({ text }) => text === "BEGIN"), false);
});

test("manual fallback remains valid and Physical meetings remain unchanged", async () => {
  const manual = openMeetingSchema.parse({
    meetingDate: "2026-09-25",
    meetingMode: "VIRTUAL",
    meetSetup: "MANUAL",
    virtualMeetingUrl: "https://meet.google.com/abc-defg-hij",
  });
  assert.equal(manual.virtualMeetingUrl, "https://meet.google.com/abc-defg-hij");
  const physical = openMeetingSchema.parse({ meetingDate: "2026-09-25" });
  assert.equal(physical.meetingMode, "PHYSICAL");
  assert.equal(physical.meetSetup, "MANUAL");
  assert.equal(physical.virtualMeetingUrl, null);

  const fake = fakePool({}, { connected: false });
  const result = await setManualGoogleMeetForMeeting(
    "group-1",
    "meeting-1",
    "https://meet.google.com/abc-defg-hij",
    { id: "user-1", organization_id: "organization-1" },
    { pool: fake.pool },
  );
  assert.equal(result.source, "MANUAL");
  assert.equal(fake.state.meeting.google_meet_space_name, null);
});

test("RESTRICTED is honored when configured and never downgraded to OPEN", async () => {
  let requested;
  await createGoogleMeetSpace("access-token", {
    accessType: "RESTRICTED",
    fetchImpl: async (_url, options) => {
      requested = JSON.parse(options.body);
      return new Response(JSON.stringify({ name: "spaces/restricted", meetingUri: "https://meet.google.com/abc-defg-hij" }), { status: 200 });
    },
  });
  assert.equal(requested.config.accessType, "RESTRICTED");
  assert.notEqual(requested.config.accessType, "OPEN");

  let calls = 0;
  await assert.rejects(
    createGoogleMeetSpace("access-token", {
      accessType: "RESTRICTED",
      fetchImpl: async () => {
        calls += 1;
        return new Response("unsupported", { status: 400 });
      },
    }),
    (error) => error.code === "GOOGLE_RESTRICTED_ACCESS_UNSUPPORTED",
  );
  assert.equal(calls, 1);
});

test("automatic Meet creation and Meet URLs remain behind existing group authorization", () => {
  const route = read("../src/app/api/v1/groups/[id]/meetings/[meetingId]/google-meet/route.js");
  const detailRoute = read("../src/app/api/v1/groups/[id]/meetings/[meetingId]/route.js");
  const publicGroupRoute = read("../src/app/api/public/groups/[id]/route.js");
  assert.match(route, /GROUP_ACTION\.MEETING_OPERATE/);
  assert.match(detailRoute, /GROUP_ACTION\.MEETING_VIEW/);
  assert.doesNotMatch(publicGroupRoute, /virtual_meeting_url|google_meet_space_name/);
});

test("Google Meet identity is optional, normalized, self-managed, and not public", () => {
  assert.deepEqual(
    googleMeetIdentitySchema.parse({ googleMeetEmail: " Operator@Example.ORG " }),
    { googleMeetEmail: "operator@example.org" },
  );
  assert.deepEqual(googleMeetIdentitySchema.parse({ googleMeetEmail: "" }), { googleMeetEmail: null });
  assert.equal(googleMeetIdentitySchema.safeParse({ googleMeetEmail: "not-an-email" }).success, false);

  const migration = read("../database/migrations/052_google_meet_operator_identity.sql");
  assert.match(migration, /ADD COLUMN google_meet_email VARCHAR\(254\)/);
  assert.doesNotMatch(migration, /google_meet_email[^;]*NOT NULL/i);

  const identityRoute = read("../src/app/api/v1/me/google-meet-email/route.js");
  assert.match(identityRoute, /const user = await requireAuth\(\)/);
  assert.match(identityRoute, /updateGoogleMeetIdentity\(user, data\.googleMeetEmail\)/);
  assert.doesNotMatch(identityRoute, /users\[id\]|targetUserId/);

  for (const path of [
    "../src/app/api/public/groups/route.js",
    "../src/app/api/public/groups/[id]/route.js",
    "../src/app/api/public/groups/[id]/join/route.js",
    "../src/modules/public/public.service.js",
  ]) {
    assert.doesNotMatch(read(path), /google_meet_email/);
  }
});

test("disconnect revokes the active local connection and browser responses never contain tokens", () => {
  const connectionService = read("../src/modules/google-integration/google-connection.service.js");
  const settingsComponent = read("../src/components/google-meet-integration-panel.js");
  const disconnectRoute = read("../src/app/api/v1/integrations/google/disconnect/route.js");
  assert.match(connectionService, /SET revoked_at=now\(\),updated_at=now\(\)/);
  assert.match(connectionService, /WHERE organization_id=\$1 AND revoked_at IS NULL/);
  assert.match(disconnectRoute, /organization\.manage/);
  assert.doesNotMatch(settingsComponent, /refresh.?token|access.?token|client.?secret|encryption.?key/i);
  assert.doesNotMatch(disconnectRoute, /refresh.?token|access.?token|client.?secret|encryption.?key/i);
});
