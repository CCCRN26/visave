# Meeting summary SMS: trial integration

Reference: cb8c35251eab35a904e5fa53c17249dead161fc0. The old implementation is adapted onto the current meeting-close workflow.

## Configuration

No environment files are edited by this integration. Add these later to the local test environment and Hostinger testvisave staging using the deployment's secret settings:

| Variable | Meaning |
| --- | --- |
| TWILIO_SMS_ENABLED | Default/unset is disabled. Only the exact string `true` permits processing. Keep `false` during this review. |
| TWILIO_TRIAL_MODE | Must be exactly `true` for any sending. Non-trial production sending remains blocked in code. |
| TWILIO_ACCOUNT_SID | Server-only Twilio account credential. |
| TWILIO_AUTH_TOKEN | Server-only Twilio secret. |
| TWILIO_FROM_NUMBER | Configured E.164 SMS sender. |
| TWILIO_TRIAL_RECIPIENTS | Preferred comma-separated, verified Nigerian E.164 trial destinations. Deduplicated. |
| TWILIO_TRIAL_RECIPIENT | Singular fallback when the plural setting is empty. |
| TWILIO_TRIAL_TEMPLATE | Approved trial message body, sent literally. Never rendered from member financial payload. |

Setting trial mode to false does not approve production sending. No production opt-in is introduced.

## Migration review

The repository's current migration line ends at 053 and has no meeting SMS outbox. Historical 040 created that outbox and 041 added the provider destination. Both are combined in `054_meeting_sms_notifications.sql`; do not restore historical filenames.

The additive schema includes member/meeting uniqueness, foreign keys to group/cycle/meeting/member/organization contexts, provider destination/SID, attempts, timestamps, and safe error metadata. The existing in-app `notifications` table remains separate. No migration has been applied. Live staging schema was not queried; deployment review must confirm it has no independently applied historical SMS table.

After implementation review, in a new local PowerShell session whose `DATABASE_URL` is confirmed to point to a disposable local database, the proposed command is:

```powershell
$env:MIGRATION_THROUGH = '054'
npm run db:migrate
```

The runner loads local environment files, sorts filenames, and records each applied filename. Verify the actual local target before executing. Do not execute this command against staging or production during this task.

## Closure and delivery

Current authorization, attendance gates, signed/current balanced reconciliation, meeting-state checks, and MEETING_CLOSED audit remain in the close transaction. Notification creation uses the same transaction after the CLOSED update and audit. A failure anywhere, including commit, rolls back the outbox and closure together.

After commit, Google Meet finalization runs first with its existing warning behavior, then SMS processing runs independently. Disabled SMS leaves valid outbox rows PENDING. Missing or malformed member phones produce SKIPPED_NO_PHONE or SKIPPED_INVALID_PHONE without failing close.

Recipients must have PRESENT attendance for the target meeting/group/cycle/organization and effective cycle membership on the meeting date. Digital Access and login accounts are not required. Both operating models use the same policy.

Enabled trial processing claims at most one eligible member notification per unique configured trial destination. Extra valid member rows become SKIPPED_TRIAL_LIMIT. Provider destinations are persisted when claimed; members' stored phone details are never changed. The provider sends only the configured literal template to configured trial destinations.

PROCESSING claims and attempt increments commit before provider calls. A meeting-row lock serializes processors; member/meeting uniqueness prevents duplicate enqueue. Subsequent processing reads only PENDING rows, so SUBMITTED, FAILED, PROCESSING and skipped rows are not automatically resent.

Provider acceptance records SUBMITTED and its message SID; this means submitted, not confirmed handset delivery. Provider failure records FAILED with a sanitized error code and fixed diagnostic text. Provider errors never reopen a meeting. If a status write fails after acceptance, only the database write is retried once, using the known SID. If persistence remains unavailable, the durable PROCESSING claim and destination remain for review, and an identifier-only warning is emitted.

## Retry limits and future hardening

There is no worker or public retry endpoint. The service's exported processor can safely resume PENDING rows after disabled mode or an interrupted pre-claim attempt, through an authorized operational workflow. It does not re-enqueue an already closed meeting.

Do not reset FAILED or PROCESSING records automatically: a timeout or interruption can occur after Twilio accepted the SMS. Check provider acceptance before any operator-approved resend. A durable worker/lease, provider reconciliation, delivery callbacks, retention/access policy for phone/payload snapshots, and a carefully authorized retry workflow are future work. Crash recovery and exactly-once provider delivery are not guaranteed by this request-based implementation.

## Local acceptance without sending

1. Review and later apply 054 only to the confirmed local database. Keep TWILIO_SMS_ENABLED=false.
2. Use synthetic members: PRESENT with usable phone, PRESENT with missing/invalid phone, absent member, and membership outside the meeting's cycle/date. Include a PRESENT member without Digital Access.
3. Close reconciled local PA and MM meetings with authorized actors. Verify CLOSED, MEETING_CLOSED audit, PENDING/skip records, and unchanged Google Meet behavior.
4. Verify invalid attendance, unsigned/stale reconciliation, and unauthorized actor failures produce no committed outbox.
5. Retry an already closed meeting and verify no new outbox rows.
6. Run SMS tests with injected repositories/SDK clients to verify SUBMITTED/SID, FAILED, trial destination mapping and repeated processing. They perform no Twilio HTTP calls.
7. Only after separate approval for a live verified-destination trial, configure the sender, credentials, verified trial destinations and literal template in Hostinger staging; set both enable/trial flags to true. This task does not perform that live acceptance.

SDK timeout/auto-retry configuration follows the [Twilio Node helper documentation](https://www.twilio.com/docs/libraries/reference/twilio-node/). The integration uses a 10-second socket timeout and explicitly disables SDK automatic retries.
