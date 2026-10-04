import { withTransaction } from "@/lib/db/transaction";
import { normalizeNigerianPhone } from "@/lib/notifications/phone";
import { isTwilioSmsEnabled, isTwilioTrialMode, submitTwilioSms, trialConfiguration } from "@/lib/notifications/twilio";
import * as repository from "./meeting-notification.repository";

const money = (value) => Number(value);

export async function createMeetingSummaryNotifications(client, meeting, repo = repository) {
  const recipients = await repo.summaryRecipients(client, meeting);
  const created = [];
  for (const recipient of recipients) {
    const phone = typeof recipient.phone === "string" ? recipient.phone.trim() : "";
    const normalizedPhone = normalizeNigerianPhone(phone);
    const status = !phone ? "SKIPPED_NO_PHONE" : normalizedPhone ? "PENDING" : "SKIPPED_INVALID_PHONE";
    const payload = {
      meetingNumber: meeting.meeting_number,
      meetingDate: meeting.meeting_date,
      memberName: recipient.member_name,
      meetingTotalSavings: money(recipient.meeting_total_savings),
      meetingTotalLoansDisbursed: money(recipient.meeting_total_loans_disbursed),
      groupTotalSavings: money(recipient.group_total_savings),
      memberTotalSavings: money(recipient.member_total_savings),
    };
    const row = await repo.insertSummary(client, {
      organizationId: meeting.organization_id, groupId: meeting.group_id, cycleId: meeting.cycle_id, meetingId: meeting.id,
      memberId: recipient.member_id, recipientPhone: normalizedPhone, payload, status,
    });
    if (row) created.push(row);
  }
  return created;
}

const safeErrorCode = (error) => {
  const code = String(error?.code || error?.status || "TWILIO_SEND_FAILED");
  return /^[A-Z0-9_]{1,64}$/.test(code) ? code : "TWILIO_SEND_FAILED";
};

/** Runs only after the close transaction has committed. It never throws provider errors. */
export async function processMeetingSummaryNotifications(meetingId, {
  env = process.env, repo = repository, submit = submitTwilioSms, getTrialConfig = trialConfiguration, transaction = withTransaction, log = console.warn,
} = {}) {
  if (!isTwilioSmsEnabled(env)) {
    log("Meeting SMS processing skipped: Twilio SMS is disabled.");
    return { state: "DISABLED" };
  }
  if (!isTwilioTrialMode(env)) {
    await transaction((client) => repo.failPendingForMeeting(client, meetingId, "PRODUCTION_SMS_NOT_APPROVED"));
    return { state: "PRODUCTION_NOT_APPROVED" };
  }
  const config = getTrialConfig(env);
  if (!config.ok) {
    await transaction((client) => repo.failPendingForMeeting(client, meetingId, config.code));
    return { state: "CONFIGURATION_INVALID" };
  }
  const notifications = await transaction((client) => repo.reserveTrialNotifications(client, meetingId, config.recipients.length, config.recipients));
  if (!notifications.length) return { state: "NOTHING_TO_SEND" };
  const results = [];
  for (const [index, notification] of notifications.entries()) {
    const providerRecipientPhone = config.recipients[index];
    let submittedSid = null;
    try {
      // Trial mode intentionally sends Twilio's configured template, never payload-derived financial text.
      const result = await submit({ to: providerRecipientPhone, from: config.from, body: config.template }, env);
      submittedSid = result.sid;
      await transaction((client) => repo.finishSubmission(client, notification.id, result.sid, providerRecipientPhone));
      results.push({ notificationId: notification.id, state: "SUBMITTED" });
    } catch (error) {
      // A provider acceptance with a failed status write must never be auto-retried.
      try {
        if (submittedSid) {
          await transaction((client) => repo.finishSubmission(client, notification.id, submittedSid, providerRecipientPhone));
          results.push({ notificationId: notification.id, state: "SUBMITTED" });
          continue;
        }
        await transaction((client) => repo.finishFailure(client, notification.id, safeErrorCode(error), "Twilio submission failed; verify provider acceptance before any retry.", providerRecipientPhone));
      } catch {
        log("Meeting SMS status persistence failed; claimed record requires review.", { notificationId: notification.id });
      }
      results.push({ notificationId: notification.id, state: "FAILED" });
    }
  }
  return { state: results.every((result) => result.state === "SUBMITTED") ? "SUBMITTED" : "PARTIALLY_FAILED", results };
}
