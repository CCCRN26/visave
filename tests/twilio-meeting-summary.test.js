import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeNigerianPhone } from "@/lib/notifications/phone";
import { renderMeetingSummary } from "@/lib/notifications/meeting-summary";
import { parseTrialRecipients, trialConfiguration, submitTwilioSms } from "@/lib/notifications/twilio";
import { createMeetingSummaryNotifications, processMeetingSummaryNotifications } from "@/modules/notifications/meeting-notification.service";
import * as repository from "@/modules/notifications/meeting-notification.repository";

const meeting = { id: "meeting-1", organization_id: "org-1", group_id: "group-1", cycle_id: "cycle-1", meeting_number: 12, meeting_date: "2026-09-22" };
const recipient = (member_id, phone) => ({ member_id, phone, member_name: member_id, meeting_total_savings: "15000.00", meeting_total_loans_disbursed: "20000.00", group_total_savings: "350000.00", member_total_savings: "45000.00" });
const trialEnv = { TWILIO_SMS_ENABLED: "true", TWILIO_TRIAL_MODE: "true" };
const trialConfig = (recipients) => () => ({ ok: true, recipients, template: "sms_event_notifications", from: "+15005550006" });

function trialRepo(records) {
  const state = { limit: null, limited: [], submitted: [], failed: [] };
  return { state, repo: {
    reserveTrialNotifications: async (_client, _meetingId, limit) => { state.limit = limit; state.limited = records.slice(limit).map((row) => row.id); return records.slice(0, limit); },
    finishSubmission: async (_client, id, sid, providerRecipientPhone) => state.submitted.push({ id, sid, providerRecipientPhone }),
    finishFailure: async (_client, id, code, message, providerRecipientPhone) => state.failed.push({ id, code, message, providerRecipientPhone }),
  } };
}

test("Nigerian transport normalization preserves E.164 and rejects malformed values", () => {
  assert.equal(normalizeNigerianPhone("08031234567"), "+2348031234567");
  assert.equal(normalizeNigerianPhone("+2348031234567"), "+2348031234567");
  assert.equal(normalizeNigerianPhone("8031234567"), null);
  for (const value of [null, undefined, "", "   ", "080 12345678", "2348012345678", "+23408012345678", "123", 8012345678]) {
    assert.equal(normalizeNigerianPhone(value), null);
  }
  assert.equal(normalizeNigerianPhone(" 08012345678 "), "+2348012345678");
});

test("trial recipients trim, deduplicate, and safely reject invalid Nigerian E.164 entries", () => {
  assert.deepEqual(parseTrialRecipients(" +2348011111111, +2348022222222 "), { recipients: ["+2348011111111", "+2348022222222"], invalid: [] });
  assert.deepEqual(parseTrialRecipients("+2348011111111, ,+2348011111111,08031111111,not-a-number"), { recipients: ["+2348011111111"], invalid: ["08031111111", "not-a-number"] });
});

test("meeting summary renderer formats the four numeric values in NGN", () => {
  const body = renderMeetingSummary({ meetingNumber: 12, meetingTotalSavings: 15000, meetingTotalLoansDisbursed: 20000, groupTotalSavings: 350000, memberTotalSavings: 45000 });
  for (const amount of ["₦15,000", "₦20,000", "₦350,000", "₦45,000"]) assert.match(body, new RegExp(amount));
});

test("outbox summary creation is idempotent and retains member phone snapshots", async () => {
  const inserted = new Map();
  const repo = { summaryRecipients: async () => [recipient("member-valid", "08031234567"), recipient("member-missing", null), recipient("member-invalid", "not-a-phone")], insertSummary: async (_client, record) => { if (inserted.has(record.memberId)) return null; inserted.set(record.memberId, record); return record; } };
  assert.equal((await createMeetingSummaryNotifications({}, meeting, repo)).length, 3);
  assert.equal((await createMeetingSummaryNotifications({}, meeting, repo)).length, 0);
  assert.equal(inserted.get("member-valid").recipientPhone, "+2348031234567");
  assert.equal(inserted.get("member-missing").status, "SKIPPED_NO_PHONE");
  assert.equal(inserted.get("member-invalid").status, "SKIPPED_INVALID_PHONE");
});

test("three configured trial recipients produce at most three unique sends and audit actual destinations", async () => {
  const memberRows = [{ id: "outbox-1", recipient_phone: "+2348099999999" }, { id: "outbox-2", recipient_phone: "+2348099999998" }, { id: "outbox-3", recipient_phone: "+2348099999997" }];
  const { repo, state } = trialRepo(memberRows);
  const calls = [], recipients = ["+2348011111111", "+2348022222222", "+2348033333333"];
  const result = await processMeetingSummaryNotifications("meeting-1", { env: trialEnv, repo, getTrialConfig: trialConfig(recipients), submit: async (message) => { calls.push(message); return { sid: `SM-${calls.length}` }; }, transaction: async (work) => work({}), log: () => {} });
  assert.equal(result.state, "SUBMITTED");
  assert.equal(state.limit, 3);
  assert.deepEqual(calls.map((call) => call.to), recipients);
  assert.equal(new Set(calls.map((call) => call.to)).size, 3);
  assert.ok(calls.every((call) => call.body === "sms_event_notifications"));
  assert.deepEqual(state.submitted.map((row) => row.providerRecipientPhone), recipients);
  assert.deepEqual(memberRows.map((row) => row.recipient_phone), ["+2348099999999", "+2348099999998", "+2348099999997"]);
});

test("fewer eligible records than configured trial recipients create no fake sends", async () => {
  const { repo, state } = trialRepo([{ id: "outbox-1" }, { id: "outbox-2" }]);
  const calls = [];
  await processMeetingSummaryNotifications("meeting-1", { env: trialEnv, repo, getTrialConfig: trialConfig(["+2348011111111", "+2348022222222", "+2348033333333"]), submit: async (message) => { calls.push(message); return { sid: "SM-test" }; }, transaction: async (work) => work({}), log: () => {} });
  assert.equal(state.limit, 3);
  assert.deepEqual(calls.map((call) => call.to), ["+2348011111111", "+2348022222222"]);
});

test("more eligible records than trial recipients leave the remainder trial-limited", async () => {
  const { repo, state } = trialRepo([{ id: "outbox-1" }, { id: "outbox-2" }, { id: "outbox-3" }]);
  await processMeetingSummaryNotifications("meeting-1", { env: trialEnv, repo, getTrialConfig: trialConfig(["+2348011111111", "+2348022222222"]), submit: async () => ({ sid: "SM-test" }), transaction: async (work) => work({}), log: () => {} });
  assert.deepEqual(state.limited, ["outbox-3"]);
});

test("Twilio provider failure is contained and cannot roll back meeting closure", async () => {
  const { repo, state } = trialRepo([{ id: "outbox-1" }]);
  const result = await processMeetingSummaryNotifications("meeting-1", { env: trialEnv, repo, getTrialConfig: trialConfig(["+2348011111111"]), submit: async () => { const error = new Error("timeout"); error.code = "ETIMEDOUT"; throw error; }, transaction: async (work) => work({}), log: () => {} });
  assert.equal(result.state, "PARTIALLY_FAILED");
  assert.deepEqual(state.failed, [{ id: "outbox-1", code: "ETIMEDOUT", message: "Twilio submission failed; verify provider acceptance before any retry.", providerRecipientPhone: "+2348011111111" }]);
  const closeSource = await readFile(new URL("../src/modules/meetings/meeting.service.js", import.meta.url), "utf8");
  assert.match(closeSource, /await enqueueSms\(c,value\);return value\}\)/);
  assert.match(closeSource, /try\{await processSms\(closed.id,options.smsOptions\)\}catch/);
});

test("disabled SMS mode leaves rows pending and never invokes Twilio", async () => {
  let called = false;
  const result = await processMeetingSummaryNotifications("meeting-1", { env: { TWILIO_SMS_ENABLED: "false" }, repo: {}, submit: async () => { called = true; }, transaction: async () => { throw new Error("disabled mode must not transact"); }, log: () => {} });
  assert.equal(result.state, "DISABLED");
  assert.equal(called, false);
});

test("migrations retain outbox uniqueness and add provider destination audit", async () => {
  const initial = await readFile(new URL("../database/migrations/054_meeting_sms_notifications.sql", import.meta.url), "utf8");
  assert.match(initial, /UNIQUE\(meeting_id,member_id,notification_type\)/);
  assert.match(initial, /provider_recipient_phone/);
});

test("recipient query enforces PRESENT, meeting/group/cycle/date/organization scope without Digital Access", async () => {
  let query;
  await repository.summaryRecipients({ query: async (sql, params) => { query = { sql, params }; return { rows: [] }; } }, meeting);
  assert.deepEqual(query.params, [meeting.group_id, meeting.cycle_id, meeting.id, meeting.meeting_date, meeting.organization_id]);
  for (const filter of ["ma.group_id=$1", "ma.cycle_id=$2", "ma.meeting_id=$3", "ma.attendance_status='PRESENT'",
    "cm.group_id=ma.group_id", "cm.cycle_id=ma.cycle_id", "cm.member_id=ma.member_id",
    "cm.participation_start_date<=$4::date", "cm.participation_end_date>=$4::date", "gm.organization_id=$5"]) {
    assert.ok(query.sql.includes(filter), filter);
  }
  assert.doesNotMatch(query.sql, /linked_user_id|user_roles|JOIN users|operation_mode/);
});

test("production sending and incomplete trial configuration persist safe failures without a provider call", async () => {
  for (const [env, expected] of [
    [{ TWILIO_SMS_ENABLED: "true", TWILIO_TRIAL_MODE: "false" }, "PRODUCTION_NOT_APPROVED"],
    [{ TWILIO_SMS_ENABLED: "true", TWILIO_TRIAL_MODE: "true" }, "CONFIGURATION_INVALID"],
  ]) {
    const failures = [];
    const result = await processMeetingSummaryNotifications(meeting.id, {
      env, repo: { failPendingForMeeting: async (_c, id, code) => failures.push({ id, code }) },
      transaction: async (work) => work({}),
      submit: async () => { assert.fail("provider must not run"); },
    });
    assert.equal(result.state, expected);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].id, meeting.id);
  }
});

const validEnv = {
  TWILIO_SMS_ENABLED: "true", TWILIO_TRIAL_MODE: "true",
  TWILIO_ACCOUNT_SID: "AC" + "0".repeat(32), TWILIO_AUTH_TOKEN: "fixture-token",
  TWILIO_FROM_NUMBER: "+15005550006", TWILIO_TRIAL_RECIPIENTS: "+2348000000001",
  TWILIO_TRIAL_TEMPLATE: "Synthetic trial template",
};

test("trial configuration supports singular fallback and rejects missing credentials, sender, or template", () => {
  assert.equal(trialConfiguration(validEnv).ok, true);
  assert.equal(trialConfiguration({ ...validEnv, TWILIO_TRIAL_RECIPIENTS: "", TWILIO_TRIAL_RECIPIENT: "+2348000000001" }).ok, true);
  for (const key of ["TWILIO_AUTH_TOKEN", "TWILIO_ACCOUNT_SID", "TWILIO_FROM_NUMBER", "TWILIO_TRIAL_TEMPLATE", "TWILIO_TRIAL_RECIPIENTS"]) {
    assert.equal(trialConfiguration({ ...validEnv, [key]: "" }).ok, false);
  }
});

test("provider helper independently blocks disabled, production, member-destination, and payload-body submissions", async () => {
  const message = { to: "+2348000000001", from: validEnv.TWILIO_FROM_NUMBER, body: validEnv.TWILIO_TRIAL_TEMPLATE };
  const clientFactory = () => { assert.fail("network-capable client must not be created"); };
  for (const [env, input] of [
    [{ ...validEnv, TWILIO_SMS_ENABLED: "false" }, message],
    [{ ...validEnv, TWILIO_TRIAL_MODE: "false" }, message],
    [validEnv, { ...message, to: "+2348000000002" }],
    [validEnv, { ...message, body: "member financial summary" }],
  ]) {
    await assert.rejects(submitTwilioSms(input, env, { clientFactory }), (error) => error.code === "TWILIO_SEND_NOT_APPROVED");
  }
});

test("provider success and failure are tested using a fake SDK client with no HTTP", async () => {
  let sdkOptions;
  const message = { to: "+2348000000001", from: validEnv.TWILIO_FROM_NUMBER, body: validEnv.TWILIO_TRIAL_TEMPLATE };
  const result = await submitTwilioSms(message, validEnv, { clientFactory: (_sid, _token, options) => {
    sdkOptions = options;
    return { messages: { create: async (input) => { assert.deepEqual(input, message); return { sid: "SM-fixture" }; } } };
  } });
  assert.equal(result.sid, "SM-fixture");
  assert.deepEqual(sdkOptions, { timeout: 10000, autoRetry: false });
  await assert.rejects(submitTwilioSms(message, validEnv, {
    clientFactory: () => ({ messages: { create: async () => { throw Object.assign(new Error("synthetic"), { code: 21608 }); } } }),
  }), (error) => error.code === 21608);
});

test("repeated processing uses atomic PENDING claims and never resends submitted or failed records", async () => {
  const rows = [{ id: "n1", status: "PENDING" }, { id: "n2", status: "PENDING" }, { id: "n3", status: "PENDING" }];
  let sends = 0;
  const client = { query: async (sql, params) => {
    if (sql.startsWith("SELECT id FROM vsla_meetings")) return { rows: [{ id: meeting.id }] };
    if (sql.includes("SELECT n.*")) {
      assert.match(sql, /m.status='CLOSED'.*n.status='PENDING'/s);
      assert.match(sql, /FOR UPDATE OF n/);
      return { rows: rows.filter((row) => row.status === "PENDING").map((row) => ({ ...row })) };
    }
    if (sql.includes("SKIPPED_TRIAL_LIMIT")) { for (const row of rows) if (params[0].includes(row.id)) row.status = "SKIPPED_TRIAL_LIMIT"; return { rows: [] }; }
    const row = rows.find((row) => row.id === params[0]);
    if (sql.includes("SET status='PROCESSING'")) { row.status = "PROCESSING"; row.provider_recipient_phone = params[1]; return { rows: [{ ...row }] }; }
    if (sql.includes("SET status='SUBMITTED'")) { row.status = "SUBMITTED"; row.sid = params[1]; return { rows: [] }; }
    throw new Error("Unexpected outbox fixture query");
  } };
  const options = { env: trialEnv, repo: repository, getTrialConfig: trialConfig(["+2348000000001", "+2348000000002"]),
    transaction: async (work) => work(client), submit: async () => { sends += 1; return { sid: "SM-fixture" }; } };
  await processMeetingSummaryNotifications(meeting.id, options);
  await processMeetingSummaryNotifications(meeting.id, options);
  assert.equal(sends, 2);
  assert.deepEqual(rows.map((row) => row.status), ["SUBMITTED", "SUBMITTED", "SKIPPED_TRIAL_LIMIT"]);
  assert.equal(rows[0].provider_recipient_phone, "+2348000000001");
});

test("provider acceptance retries only the database status write, never the SMS", async () => {
  let sends = 0, writes = 0;
  const { repo } = trialRepo([{ id: "n1" }]);
  repo.finishSubmission = async () => { if (++writes === 1) throw new Error("transient database failure"); };
  const result = await processMeetingSummaryNotifications(meeting.id, {
    env: trialEnv, repo, getTrialConfig: trialConfig(["+2348000000001"]),
    transaction: async (work) => work({}), submit: async () => { sends += 1; return { sid: "SM-fixture" }; },
  });
  assert.equal(sends, 1);
  assert.equal(writes, 2);
  assert.equal(result.state, "SUBMITTED");
});

test("failure persistence outage remains contained and logs only a notification identifier", async () => {
  const logs = [];
  const { repo } = trialRepo([{ id: "n1" }]);
  repo.finishFailure = async () => { throw new Error("database unavailable"); };
  await processMeetingSummaryNotifications(meeting.id, {
    env: trialEnv, repo, getTrialConfig: trialConfig(["+2348000000001"]), log: (...args) => logs.push(args),
    transaction: async (work) => work({}), submit: async () => { throw new Error("synthetic"); },
  });
  assert.equal(logs.length, 1);
  assert.deepEqual(logs[0][1], { notificationId: "n1" });
});

test("integration keeps the Webpack build and in-app notifications separate", async () => {
  const pkg = JSON.parse(await readFile("package.json", "utf8"));
  assert.equal(pkg.scripts.build, "next build --webpack");
  const service = await readFile("src/modules/notifications/notification.service.js", "utf8");
  assert.doesNotMatch(service, /meeting_notifications|TWILIO/);
});
