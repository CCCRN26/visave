import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { encryptGoogleRefreshToken } from "../src/lib/security/google-token-encryption.js";
import { createGoogleMeetCohost, endGoogleMeetConference } from "../src/modules/google-integration/google-meet.service.js";
import { closeMeeting } from "../src/modules/meetings/meeting.service.js";

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8");
const originalEnvironment = {
  GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI: process.env.GOOGLE_REDIRECT_URI,
  GOOGLE_TOKEN_ENCRYPTION_KEY: process.env.GOOGLE_TOKEN_ENCRYPTION_KEY,
};

test.before(() => {
  process.env.GOOGLE_CLIENT_ID = "client-id";
  process.env.GOOGLE_CLIENT_SECRET = "client-secret";
  process.env.GOOGLE_REDIRECT_URI = "https://visave.example/google/callback";
  process.env.GOOGLE_TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString("base64");
});

test.after(() => {
  for (const [name, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
});

test("co-host creation awaits bounded provider readiness verification", async () => {
  const events = [];
  let reads = 0;
  const result = await createGoogleMeetCohost("access-token", "spaces/space-123", "operator@example.org", {
    wait: async (milliseconds) => events.push(`wait:${milliseconds}`),
    fetchImpl: async (url, options) => {
      if (options.method === "POST") {
        events.push("create");
        return new Response(JSON.stringify({ name: "spaces/space-123/members/member-1" }), { status: 200 });
      }
      events.push("verify");
      reads += 1;
      return new Response(JSON.stringify({
        members: reads === 2 ? [{ email: "operator@example.org", role: "COHOST" }] : [],
      }), { status: 200 });
    },
  });
  assert.deepEqual(result, { alreadyAssigned: false, ready: true });
  assert.deepEqual(events, ["create", "wait:250", "verify", "wait:500", "verify"]);
});

test("409 membership creation remains idempotent and is verified as ready", async () => {
  const result = await createGoogleMeetCohost("access-token", "spaces/space-123", "operator@example.org", {
    wait: async () => {},
    fetchImpl: async (_url, options) => options.method === "POST"
      ? new Response(JSON.stringify({ error: { status: "ALREADY_EXISTS" } }), { status: 409 })
      : new Response(JSON.stringify({ members: [{ email: "operator@example.org", role: "COHOST" }] }), { status: 200 }),
  });
  assert.deepEqual(result, { alreadyAssigned: true, ready: true });
});

test("operator Join control stays hidden while co-host readiness is pending", () => {
  const panel = read("../src/components/google-meet-setup-panel.js");
  const startForm = read("../src/components/start-meeting-form.js");
  assert.match(panel, /cohostStatus !== "PENDING".*Join Meeting/);
  assert.match(panel, /Preparing Google Meet/);
  assert.match(panel, /initialCohostStatus !== "PENDING"/);
  assert.match(startForm, /"PENDING"/);
});

function closeHarness(meetingMode, googleMeetSpaceName) {
  const events = [];
  const meeting = {
    id: "meeting-1",
    group_id: "group-1",
    cycle_id: "cycle-1",
    organization_id: "org-1",
    status: "OPEN",
    meeting_mode: meetingMode,
    google_meet_space_name: googleMeetSpaceName,
  };
  const client = {
    async query(sql) {
      if (sql.includes("SELECT cy.id FROM vsla_cycles")) return { rows: [{ id: "cycle-1" }] };
      if (sql.includes("FROM vsla_cycles cy JOIN vsla_meetings")) return { rows: [{ ...meeting, group_status: "ACTIVE", cycle_status: "ACTIVE" }] };
      if (sql.includes("attendance_status='UNMARKED'")) return { rows: [{ n: 0 }] };
      if (sql.includes("FROM meeting_reconciliations")) return { rows: [{ savings_loan_difference: "0.00", social_fund_difference: "0.00", expected_savings_loan_balance: "100.00", expected_social_fund_balance: "20.00" }] };
      if (sql.includes("account_code='SAVINGS_LOAN_CASH'")) return { rows: [{ savings_loan: "100.00", social_fund: "20.00" }] };
      if (sql.includes("UPDATE vsla_meetings SET status='CLOSED'")) return { rows: [{ ...meeting, status: "CLOSED" }] };
      if (sql.includes("INSERT INTO audit_logs")) return { rows: [] };
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const transaction = async (work) => {
    events.push("BEGIN");
    const result = await work(client);
    events.push("COMMIT");
    return result;
  };
  return { events, transaction };
}

test("automatic Virtual and Hybrid close commit before ending the active conference", async () => {
  for (const mode of ["VIRTUAL", "HYBRID"]) {
    const harness = closeHarness(mode, "spaces/space-123");
    const result = await closeMeeting("group-1", "meeting-1", { id: "user-1", organization_id: "org-1" }, {
      transaction: harness.transaction,
      endConference: async () => harness.events.push("END_CONFERENCE"),
    });
    assert.deepEqual(harness.events, ["BEGIN", "COMMIT", "END_CONFERENCE"]);
    assert.equal(result.status, "CLOSED");
    assert.equal(result.googleMeetConferenceEnded, true);
  }
});

test("Physical and manually linked meetings make no Google end request", async () => {
  for (const mode of ["PHYSICAL", "VIRTUAL"]) {
    const harness = closeHarness(mode, null);
    let calls = 0;
    const result = await closeMeeting("group-1", "meeting-1", { id: "user-1", organization_id: "org-1" }, {
      transaction: harness.transaction,
      endConference: async () => { calls += 1; },
    });
    assert.equal(calls, 0);
    assert.equal(result.status, "CLOSED");
  }
});

test("Google end failure cannot roll back a successfully closed Visave meeting", async () => {
  const harness = closeHarness("VIRTUAL", "spaces/space-123");
  const result = await closeMeeting("group-1", "meeting-1", { id: "user-1", organization_id: "org-1" }, {
    transaction: harness.transaction,
    endConference: async () => { harness.events.push("END_FAILED"); throw new Error("provider unavailable"); },
  });
  assert.deepEqual(harness.events, ["BEGIN", "COMMIT", "END_FAILED"]);
  assert.equal(result.status, "CLOSED");
  assert.match(result.googleMeetWarning, /Visave meeting closed/);
});

test("endActiveConference uses the stored Space.name and existing OAuth connection", async () => {
  const encrypted = encryptGoogleRefreshToken("refresh-token");
  const pool = { query: async () => ({ rows: [{
    encrypted_refresh_token: encrypted.encryptedRefreshToken,
    token_iv: encrypted.tokenIv,
    token_auth_tag: encrypted.tokenAuthTag,
    encryption_key_version: encrypted.encryptionKeyVersion,
  }] }) };
  const calls = [];
  const result = await endGoogleMeetConference(
    { google_meet_space_name: "spaces/space-123" },
    { organization_id: "org-1" },
    {
      pool,
      fetchImpl: async (url, options) => {
        calls.push({ url, method: options.method });
        if (url === "https://oauth2.googleapis.com/token") return new Response(JSON.stringify({ access_token: "access-token" }), { status: 200 });
        return new Response(JSON.stringify({}), { status: 200 });
      },
    },
  );
  assert.equal(result.ended, true);
  assert.equal(calls[1].url, "https://meet.googleapis.com/v2/spaces/space-123:endActiveConference");
  assert.equal(calls[1].method, "POST");
});

test("operator meeting page exposes Join only for OPEN meetings", () => {
  const page = read("../src/app/(protected)/groups/[id]/meetings/[meetingId]/page.js");
  assert.match(page, /data\.meeting\.status === "OPEN"[\s\S]*isGoogleMeetUrl/);
  assert.match(page, /Virtual meeting ended/);
});
