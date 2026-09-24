import twilio from "twilio";
import { normalizeNigerianPhone } from "./phone.js";

export const isTwilioSmsEnabled = (env = process.env) => env.TWILIO_SMS_ENABLED === "true";
export const isTwilioTrialMode = (env = process.env) => env.TWILIO_TRIAL_MODE === "true";
const isE164 = (value) => /^\+[1-9]\d{7,14}$/.test(value || "");

export function parseTrialRecipients(value) {
  const recipients = [];
  const invalid = [];
  const seen = new Set();
  for (const entry of String(value || "").split(",").map((item) => item.trim()).filter(Boolean)) {
    const recipient = /^\+234[789]\d{9}$/.test(entry) ? normalizeNigerianPhone(entry) : null;
    if (!recipient) { invalid.push(entry); continue; }
    if (!seen.has(recipient)) { seen.add(recipient); recipients.push(recipient); }
  }
  return { recipients, invalid };
}

export function trialConfiguration(env = process.env) {
  const configuredRecipients = env.TWILIO_TRIAL_RECIPIENTS?.trim();
  const parsedRecipients = parseTrialRecipients(configuredRecipients || env.TWILIO_TRIAL_RECIPIENT);
  const template = env.TWILIO_TRIAL_TEMPLATE?.trim();
  const from = env.TWILIO_FROM_NUMBER?.trim();
  if (!parsedRecipients.recipients.length) return { ok: false, code: "TWILIO_TRIAL_RECIPIENTS_INVALID" };
  if (!template) return { ok: false, code: "TWILIO_TRIAL_TEMPLATE_MISSING" };
  if (!isE164(from)) return { ok: false, code: "TWILIO_FROM_NUMBER_INVALID" };
  if (!env.TWILIO_ACCOUNT_SID?.trim() || !env.TWILIO_AUTH_TOKEN?.trim()) return { ok: false, code: "TWILIO_CREDENTIALS_MISSING" };
  return { ok: true, recipients: parsedRecipients.recipients, invalidRecipientCount: parsedRecipients.invalid.length, template, from };
}

export async function submitTwilioSms({ to, body, from }, env = process.env) {
  const accountSid = env.TWILIO_ACCOUNT_SID?.trim();
  const authToken = env.TWILIO_AUTH_TOKEN?.trim();
  if (!accountSid || !authToken || !from || !to || !body) {
    const error = new Error("Twilio SMS configuration is incomplete");
    error.code = "TWILIO_CONFIGURATION_INVALID";
    throw error;
  }
  const result = await twilio(accountSid, authToken).messages.create({ to, from, body });
  return { sid: result.sid };
}
