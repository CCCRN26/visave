import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { normalizeNigerianPhone } from "@/lib/notifications/phone";
import { renderMeetingSummary } from "@/lib/notifications/meeting-summary";
import { parseTrialRecipients } from "@/lib/notifications/twilio";
import { createMeetingSummaryNotifications, processMeetingSummaryNotifications } from "@/modules/notifications/meeting-notification.service";

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
  assert.deepEqual(state.failed, [{ id: "outbox-1", code: "ETIMEDOUT", message: "Twilio submission failed.", providerRecipientPhone: "+2348011111111" }]);
  const closeSource = await readFile(new URL("../src/modules/meetings/meeting.service.js", import.meta.url), "utf8");
  assert.match(closeSource, /const closed=await withTransaction[\s\S]*?createMeetingSummaryNotifications[\s\S]*?\}\);try\{await processMeetingSummaryNotifications/);
});

test("disabled SMS mode leaves rows pending and never invokes Twilio", async () => {
  let called = false;
  const result = await processMeetingSummaryNotifications("meeting-1", { env: { TWILIO_SMS_ENABLED: "false" }, repo: {}, submit: async () => { called = true; }, transaction: async () => { throw new Error("disabled mode must not transact"); }, log: () => {} });
  assert.equal(result.state, "DISABLED");
  assert.equal(called, false);
});

test("migrations retain outbox uniqueness and add provider destination audit", async () => {
  const [initial, audit] = await Promise.all([readFile(new URL("../database/migrations/040_twilio_meeting_summary_notifications.sql", import.meta.url), "utf8"), readFile(new URL("../database/migrations/041_twilio_trial_provider_recipient.sql", import.meta.url), "utf8")]);
  assert.match(initial, /UNIQUE\(meeting_id,member_id,notification_type\)/);
  assert.match(audit, /provider_recipient_phone/);
});
