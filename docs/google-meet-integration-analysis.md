# Visave Google Meet Integration Analysis

## Executive Summary

Visave should treat Google Meet as a communication channel attached to a Visave meeting. Google Meet must not become the source of truth for meeting status, attendance, financial activity, reconciliation, or closure.

The safest rollout is:

1. Add `PHYSICAL`, `VIRTUAL`, and `HYBRID` meeting modes plus an optional, validated Google Meet URL.
2. Initially let an authorized meeting operator paste a Google Meet URL created outside Visave.
3. After the manual workflow is proven, add automatic link creation with the Google Meet REST API `spaces.create` method.
4. Use one dedicated, organization-owned Google Workspace account as the Google meeting owner. Connect that account to Visave once with server-side OAuth and offline access.
5. Consider Calendar events, invitations, and Meet attendance analytics only in later phases.

The Google Meet REST API is a better automatic-creation fit than Google Calendar today. Visave does not schedule meeting records in advance: selecting **Start meeting** creates a meeting directly in `OPEN` status, rejects future dates, records `opened_at`, and immediately creates the attendance snapshot. A Meet space can likewise be created immediately and returns a `meetingUri`. Calendar event creation would require scheduled start and end times that Visave does not currently possess, would create calendar ownership and invitation behavior, and would require an additional Calendar scope.

The implementation must keep the external Google call outside financial transactions and meeting-close transactions. A Google failure may leave an open Visave meeting without a virtual link, but must never roll back, duplicate, or corrupt financial records. The operator must be able to retry or paste a manual link.

## Current Meeting Architecture

The operational hierarchy is:

```text
Organization
  -> Project / geographic scope
    -> VSLA Group
      -> Approved Constitution
        -> Active Cycle
          -> Open Visave Meeting
            -> Attendance snapshot
            -> Financial and loan activity
            -> Signed reconciliation
            -> Closed meeting
```

Important current characteristics:

- A group has a default `meeting_location`; an individual meeting does not have its own location.
- A cycle can record `meeting_day_of_week`, but that is a cadence preference, not a schedule of future meeting instances.
- A meeting is created only when it is started. Creation and start are the same operation.
- `meeting_date` is a date only. Future dates are rejected.
- `opened_at`, `closed_at`, and `cancelled_at` are lifecycle timestamps, not scheduled start/end times.
- There is no `SCHEDULED` status, scheduled-meeting table, time-of-day field, timezone field, URL field, or generic external-session field.
- Only one meeting may be `OPEN` in a cycle.
- Opening a meeting snapshots all members participating in the cycle on that date into `meeting_attendance` with `UNMARKED` status.
- Financial operations require the group, cycle, and meeting to be active/open.
- Closing makes operational controls read-only. Cancellation is allowed only while open and only when no unreversed financial transaction remains.

Therefore, adding a virtual channel is compatible with the current meeting row, but advance scheduling is a separate product change and should not be smuggled into the first Google Meet release.

## Current Database Model

### Meeting-related tables and relationships

| Table | Key and relationships | Lifecycle and audit fields | Important constraints |
|---|---|---|---|
| `vsla_groups` | `id` UUID PK; belongs to `organization_id` and `project_id`; optional assigned `facilitator_user_id` | `status`, `operation_mode`, `created_by`, `created_at`, `updated_at` | Group code unique per organization. `meeting_location` exists here. Modes are `PROGRAM_ASSISTED` and `MEMBER_MANAGED`. |
| `vsla_cycles` | `id` UUID PK; composite relationship to group and constitution | `start_date`, `expected_end_date`, `expected_shareout_date`, `activated_at`, `closed_at`, `created_by`, timestamps | Cycle number unique per group; one active cycle per group; statuses are `DRAFT`, `READY`, `ACTIVE`, `CLOSING`, `CLOSED`, `CANCELLED`. `meeting_day_of_week` is optional. |
| `cycle_memberships` | `id` UUID PK; composite FKs to group/cycle and group/member | Participation start/end dates, `created_by`, timestamps | One membership per member per cycle; dates must fall within the cycle and membership dates. This is the correct basis for member access to a virtual meeting. |
| `group_officer_assignments` | `id` UUID PK; composite FKs to group/cycle/member | `status`, appointed/ended dates, `created_by`, timestamps | One active holder of each position and one active position per member in a cycle. |
| `vsla_meetings` | `id` UUID PK; organization FK; group FK; composite group/cycle FK | `meeting_number`, `meeting_code`, `meeting_date`, `status`, opening balances, `opened_by/at`, `closed_by/at`, `cancelled_by/at`, cancellation reason, timestamps | Status is `OPEN`, `CLOSED`, or `CANCELLED`; meeting number unique per cycle; meeting code globally unique; one open meeting per cycle; composite unique keys support downstream financial FKs. There is no `created_by` or `updated_by`; the lifecycle actors serve that purpose. |
| `meeting_attendance` | `id` UUID PK; composite FKs to meeting/group/cycle and member/group | `attendance_status`, notes, `recorded_by/at`, timestamps | One row per member per meeting. Status is `UNMARKED`, `PRESENT`, `LATE`, `ABSENT`, or `EXCUSED`. |
| `meeting_reconciliations` | `id` UUID PK; stores group, cycle, and meeting IDs; composite group/meeting FK | Expected/counted fund balances, notes, `created_by`, `created_at` | Differences and `BALANCED`/`VARIANCE` status are generated columns. Multiple reconciliations may exist; the latest is authoritative. The copied `cycle_id` has no separate direct FK in migration 016, but the meeting supplies the logical cycle relationship. |
| `reconciliation_signatures` | `id` UUID PK; FKs to organization, group, meeting, reconciliation, and signing user | `signed_by_user_id`, `signed_at`, file metadata, `created_at` | One signature per reconciliation; private PNG only; size and hash validated. |
| `audit_logs` | `id` UUID PK; optional organization, actor, entity references | Action, old/new JSON values, IP, user agent, `created_at` | Indexed by organization, actor, and entity. This can preserve Meet-link replacement history without a second session table in V1. |

### Current meeting fields relevant to Google Meet

- Meeting number: `vsla_meetings.meeting_number`.
- Meeting date: `vsla_meetings.meeting_date` (`DATE`).
- Actual start: `opened_at` (`TIMESTAMPTZ`, defaults to `now()`).
- Actual end: `closed_at` (`TIMESTAMPTZ`, nullable).
- Status: `OPEN`, `CLOSED`, or `CANCELLED`.
- Physical location: only `vsla_groups.meeting_location`; no per-meeting snapshot or override.
- URL or provider metadata: none.
- Advance scheduling: none.
- Meeting creation metadata: `opened_by` and `opened_at`.
- Update actor: no generic `updated_by`; specific close/cancel actors and audit log are used.

The schema can be extended safely because `vsla_meetings` already owns the operational identity and lifecycle of one meeting. Virtual metadata must remain optional so all historical meetings continue to mean `PHYSICAL`.

## Current Meeting Lifecycle

The implemented flow is:

```text
Active group
  -> Active cycle with approved constitution
  -> Start meeting (creates OPEN meeting now)
  -> Attendance snapshot created automatically
  -> Mark attendance
  -> Record Social Fund, savings, fines, loans, and repayments as authorized
  -> Reconcile expected and counted fund balances
  -> Capture PNG signature with the reconciliation
  -> Close meeting
```

Specific behavior:

1. An authorized operator opens **Meetings** and selects **Start meeting**.
2. The form accepts only `meetingDate`, with today as the default and maximum.
3. The service locks the group and active cycle, confirms the group is active, confirms an active cycle and approved constitution, rejects dates outside the cycle or in the future, and rejects a second open meeting.
4. The service assigns the next meeting number, stores opening fund balances, inserts the meeting as `OPEN`, and creates the attendance snapshot.
5. Attendance is immediately available. It becomes read-only after closure.
6. Financial postings and reversals require an open meeting and active cycle. The existing append-only ledger and reversal rules remain authoritative.
7. Reconciliation is available only for an open meeting. The application requires a PNG signature and inserts the reconciliation and signature together.
8. Closure requires all attendance marked and the latest reconciliation to be balanced and current against live ledger balances. The close service does not perform a separate signature lookup, but the supported application reconciliation path creates the signature atomically with each reconciliation, so a reconciliation created through Visave is signed.
9. After closure, the meeting workspace hides mutation controls. Direct edits of posted financial history remain prohibited.
10. An open meeting may be cancelled only when it has no unreversed financial transactions. The service and protected API route exist, but the inspected meeting workspace does not currently render a cancellation control.

Google Meet must not add another financial or attendance lifecycle. It should be a panel attached to the Visave meeting and governed by the same `OPEN`/`CLOSED`/`CANCELLED` state.

## Roles and Authorization

### Implemented authorization

The route permission is only the first gate. `requireGroupRouteAction` also evaluates program scope, facilitator assignment, operation mode, active cycle membership, and current officer assignment.

| Actor | Program Assisted | Member Managed |
|---|---|---|
| `SUPER_ADMIN` | May operate meetings within the organization. | May operate through program scope. |
| Scoped `PROJECT_ADMIN` | May create/start, operate, reconcile/sign, cancel, and close meetings in scope. | Same program-scope override applies. |
| Scoped `STATE_COORDINATOR` | May create/start, operate, reconcile/sign, cancel, and close meetings in scope. | Same program-scope override applies. |
| Assigned active `FACILITATOR` with project/geographic scope | May view and operate the assigned group's meeting, including attendance, financial activity, reconciliation/signature, cancellation, and closure. | View-only for operational meeting data; may not operate the meeting. |
| Current digital `CHAIRPERSON` | May view and operate the meeting, record attendance and finance, reconcile/sign, repay loans, cancel, and close. | May perform the same meeting operations. |
| Current digital `RECORD_KEEPER` | View-only for the operational workspace. | May start, operate, reconcile/sign, cancel, and close; also receives the implemented loan request/disbursement duties. |
| `BOX_KEEPER`, `MONEY_COUNTER_1`, `MONEY_COUNTER_2` | No digital officer workspace or meeting-operation authority from their position. | No digital officer workspace or meeting-operation authority from their position. |
| Ordinary `VSLA_MEMBER` | The base role permission does not grant the operational meeting page because the dynamic group guard also requires an eligible officer relationship. The member uses **My Activity**. | Same. |

There is no separate signing permission. Reconciliation operators provide the required signature as part of reconciliation.

### Recommended Meet authorization

- **Create automatic Meet link:** require the existing `MEETING_OPERATE` action and an `OPEN` meeting.
- **Paste or replace a manual Meet link:** require `MEETING_OPERATE` and an `OPEN` meeting.
- **Regenerate a link:** require `MEETING_OPERATE`, explicit confirmation, a row lock, and an audit record.
- **Remove/cancel the virtual channel:** require `MEETING_OPERATE`. This is different from cancelling the Visave meeting.
- **Cancel the Visave meeting:** keep the existing meeting cancellation rules. A virtual link must not weaken the unreversed-transaction guard.
- **View/join as staff or an officer:** require existing meeting view access for the target group.
- **View/join as an ordinary member:** use the existing linked-member self-service path and require active group membership plus effective `cycle_memberships` participation for the meeting date. Do not grant ordinary members the full operational meeting page.
- **Share through a future notification action:** require `MEETING_OPERATE`. A member may copy their visible join link for personal use, but should not receive a bulk-share control.
- **Public users and public Join/Find Group pages:** never expose the link.

No new broad role is needed. If a named permission is desirable for audit clarity, it should map to the same actors as `MEETING_OPERATE`, not create a second authorization model.

## Google Integration Options

### Option A: Google Calendar API with `conferenceData`

Flow: create a Calendar event with start/end times and `conferenceData.createRequest`, pass `conferenceDataVersion=1`, then read the generated Meet entry point. Conference generation can be asynchronous and initially return `pending`. Google recommends a unique conference per event. See [Create events](https://developers.google.com/workspace/calendar/api/guides/create-events) and the [Events resource](https://developers.google.com/workspace/calendar/api/v3/reference/events).

| Consideration | Assessment for Visave |
|---|---|
| Setup | Google Cloud project, Calendar API, OAuth consent, web OAuth client, token storage, event ownership, and callback handling. |
| OAuth | A user-authorized Calendar write scope is required. `calendar.events.owned` is narrower than full Calendar access and covers events on calendars the user owns. |
| Workspace requirement | Calendar can be used by consumer or Workspace Google accounts, subject to account policies and features. Domain-wide delegation requires a managed Workspace domain. |
| Scheduling | Strong. Native start/end, reminders, recurrence, and event status. |
| Invitations | Strong. Guests and update notifications can be managed by Calendar. |
| Cancellation | Calendar events can be deleted with guest updates. |
| Token burden | Refresh token for the owning Google account unless domain-wide delegation is used. |
| Implementation | High because Visave first needs a scheduled meeting concept, start/end time, timezone, event synchronization, asynchronous conference readiness, and cancellation semantics. |
| Fit | Poor for V1; attractive only when Visave intentionally adds advance scheduling and calendar invitations. |

### Option B: Google Meet REST API / Spaces API

Flow: call `POST https://meet.googleapis.com/v2/spaces`, receive `name`, `meetingUri`, and `meetingCode`, store the resource name and URI, then show the URI in Visave. A Meet space is a persistent virtual place; the first participant starts a conference. See [`spaces.create`](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces/create), [meeting spaces overview](https://developers.google.com/workspace/meet/api/guides/meeting-spaces-overview), and the [spaces resource](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces).

| Consideration | Assessment for Visave |
|---|---|
| Setup | Google Cloud project, Meet REST API, OAuth consent, web OAuth client, and secure token handling. |
| OAuth | `https://www.googleapis.com/auth/meetings.space.created` creates, reads, and modifies spaces created by Visave. Google states that Meet REST API uses user authentication; domain-wide delegation works by impersonating a Workspace user. |
| Workspace requirement | Ordinary user OAuth is the normal model. Domain-wide delegation requires a Workspace administrator and cannot be used with a personal Gmail account. Account feature and admin policy differences must be tested in the pilot. |
| Scheduling | None. The space has a join URI but is not a Calendar event. This matches Visave's immediate-open lifecycle. |
| Invitations | None by itself. Visave notifications or a later Calendar phase must distribute invitations. |
| Retrieval/control | Can get and patch a space, manage space members/co-hosts, and end an active conference. The API exposes no `spaces.delete` method, so Visave cancellation must primarily hide/deactivate the link in Visave. |
| Token burden | One central refresh token in the recommended model. |
| Implementation | Medium to high, mostly because of OAuth, token security, retries, and lifecycle isolation—not because of the `spaces.create` call itself. |
| Fit | Best automatic-creation option for the current application. |

Meet space access can be `OPEN`, `TRUSTED`, or `RESTRICTED`. `OPEN` lets anyone with join information join without knocking according to the API definition; organization policies and account type can still affect actual joining behavior. Co-host membership can be assigned by email. See [space configuration](https://developers.google.com/workspace/meet/api/reference/rest/v2/spaces) and [meeting space members](https://developers.google.com/workspace/meet/api/guides/meeting-space-members).

### Option C: Manual Google Meet URL

Flow: an authorized operator creates a link in Google Meet or Calendar, chooses `VIRTUAL` or `HYBRID`, and pastes the canonical `https://meet.google.com/...` URL into Visave.

| Consideration | Assessment for Visave |
|---|---|
| Setup | No Google Cloud project, OAuth, token, library, or server-to-Google call. |
| Account ownership | The person who created the link owns the Google meeting. Personal Gmail can be used, subject to Meet product limits. |
| Scheduling/invitations | Managed externally, not synchronized with Visave. |
| Cancellation/control | Visave can hide or replace the URL, but cannot manage the Google space. |
| Risks | Wrong link, reused link, departed owner, weak audit outside Visave, link leakage, and no API verification that the URL is usable. |
| Implementation | Low. Validate and normalize the host and path, store the link, authorize access, and audit replacements. |
| Fit | Best Phase 1 because it proves the user flow without introducing OAuth risk. |

### Option comparison and decision

| Capability | Manual URL | Meet REST Spaces | Calendar + conference data |
|---|---:|---:|---:|
| No Google integration credentials | Yes | No | No |
| Matches immediate **Start meeting** | Yes | Yes | Weak |
| Native scheduling | External only | No | Yes |
| Calendar invitations | External only | No | Yes |
| Visave can inspect/manage resource | No | Yes, within API methods | Yes, as Calendar event owner |
| Lowest V1 risk | Best | Good Phase 2 | Poor V1 |
| Members must own Google accounts | No; joining rules can require admission | No in principle; joining rules/admin policy apply | Invitations work best with account emails, but guests may still join by link |

## Recommended Google Architecture

### Recommended target

Use a phased manual-to-automatic design:

- **Phase 1:** manual Google Meet URL on an open virtual/hybrid meeting.
- **Phase 2:** automatic Google Meet REST `spaces.create`, owned by a dedicated Visave organization Workspace account.
- **Do not use Calendar in Phase 2.** Add it only when advance scheduling and invitations become explicit Visave requirements.

Automatic creation sequence:

1. An authorized user starts a Visave meeting with `meeting_mode` set.
2. Visave commits the normal open-meeting transaction and attendance snapshot.
3. For `VIRTUAL` or `HYBRID`, the meeting workspace shows **Create Google Meet**.
4. A separate server request locks the meeting, confirms it is `OPEN`, and confirms no virtual link already exists.
5. The server obtains an access token for the central organization account and calls `spaces.create` with an idempotency guard in Visave.
6. Only after Google succeeds does Visave store `meetingUri` and `space.name`, then write an audit event.
7. If Google fails, the meeting remains valid and open. The operator sees **Retry** and **Paste a Meet link instead**.
8. Join-link retrieval always passes Visave authorization. The raw link is never returned by public endpoints.

Google creation must never run inside the PostgreSQL transaction that creates, reconciles, closes, or financially posts to a meeting. External latency and failure must remain isolated.

## Recommended Database Changes

### Meeting mode

Adding `meeting_mode` fits the existing model. It describes how one operational meeting is attended; it does not change the meeting's financial meaning.

Use exactly:

- `PHYSICAL`
- `VIRTUAL`
- `HYBRID`

Existing rows default to `PHYSICAL`.

### Smallest meeting schema change

| Table | Column | Type | Null/default | Purpose | Sensitive | Index | Unique |
|---|---|---|---|---|---|---|---|
| `vsla_meetings` | `meeting_mode` | `VARCHAR(10)` with check | `NOT NULL DEFAULT 'PHYSICAL'` | Physical, virtual, or hybrid attendance channel | No | No | No |
| `vsla_meetings` | `virtual_meeting_url` | `TEXT` | Nullable, no default | Canonical Google Meet join URI for manual or API-created sessions | Confidential join capability, but not an OAuth secret | Partial unique index | Yes when non-null |
| `vsla_meetings` | `google_meet_space_name` | `VARCHAR(255)` | Nullable, no default | Immutable API resource name such as `spaces/...`; null for a manual link | Internal metadata | Partial unique index | Yes when non-null |

Recommended checks:

- `meeting_mode IN ('PHYSICAL','VIRTUAL','HYBRID')`.
- `PHYSICAL` rows must not expose a virtual URL.
- A `google_meet_space_name` requires a `virtual_meeting_url`.
- `VIRTUAL` and `HYBRID` may temporarily have a null URL so a Google outage cannot block the Visave meeting or force an unsafe distributed transaction.
- Validate and normalize the URL in application validation. Accept only HTTPS URLs on `meet.google.com` with a valid Meet code path; reject credentials, alternate hosts, fragments, and arbitrary redirect URLs.

Do not add these fields in the first design:

- `meeting_location`: the group already has `meeting_location`; a per-meeting snapshot can be considered separately if groups genuinely vary venues.
- `virtual_meeting_provider`: only Google Meet is approved; `google_meet_space_name` already distinguishes managed Google sessions.
- `google_meet_code`: redundant with Google's resource response and join URL.
- `google_event_id`: no Calendar event exists in the recommended phase.
- `virtual_meeting_created_by` and `virtual_meeting_created_at`: existing audit logs record link creation/replacement actor and time; adding duplicate fields is not justified.
- `scheduled_start_at`, `scheduled_end_at`, or `timezone`: these imply a scheduling model Visave does not currently have.

### Direct columns versus `meeting_virtual_sessions`

Use direct columns on `vsla_meetings` for V1 and Phase 2.

Reasons:

- The product requirement is one active Meet space per Visave meeting.
- The common query is meeting plus its current join link.
- The current meeting row already owns status and access scope.
- Replacements are infrequent and can be preserved in `audit_logs` with old/new values.
- A separate table would add joins, separate lifecycle rules, and opportunities for multiple active sessions without delivering a present requirement.

Move to a separate `meeting_virtual_sessions` table only if Visave later supports multiple providers, multiple sessions per meeting, immutable replacement history as a reporting requirement, breakout sessions, or scheduled attempts independent of the meeting row.

### OAuth connection storage for automatic creation

Phase 1 requires no OAuth table. Before Phase 2, add a separate organization-level connection, not token columns on `users` or `vsla_meetings`.

Suggested future table: `google_oauth_connections`.

| Table | Column | Type | Null/default | Purpose | Sensitive | Index | Unique |
|---|---|---|---|---|---|---|---|
| `google_oauth_connections` | `id` | `UUID` PK | `NOT NULL DEFAULT gen_random_uuid()` | Connection identity | No | PK | Yes |
| `google_oauth_connections` | `organization_id` | `UUID` FK to `organizations(id)` | `NOT NULL` | Owns one central Google connection | No | Unique index | Yes |
| `google_oauth_connections` | `google_subject` | `VARCHAR(255)` | `NOT NULL` | Stable Google identity from OpenID Connect | Personal identifier | No | No; organization is already unique |
| `google_oauth_connections` | `google_account_email` | `VARCHAR(254)` | `NOT NULL` | Admin-visible connected account identity | Personal identifier | No | No |
| `google_oauth_connections` | `encrypted_refresh_token` | `BYTEA` | `NOT NULL` | AES-GCM ciphertext, including nonce/authentication data according to the chosen envelope format | **Highly sensitive** | No | No |
| `google_oauth_connections` | `encryption_key_version` | `SMALLINT` | `NOT NULL` | Selects the server-side encryption key during rotation | Security metadata | No | No |
| `google_oauth_connections` | `granted_scopes` | `TEXT[]` | `NOT NULL` | Exact consented scopes for drift and reauthorization checks | No | No | No |
| `google_oauth_connections` | `status` | `VARCHAR(20)` with check | `NOT NULL DEFAULT 'ACTIVE'` | `ACTIVE`, `REAUTH_REQUIRED`, or `REVOKED` | No | No | No |
| `google_oauth_connections` | `connected_by` | `UUID` FK to `users(id)` | `NOT NULL` | Visave administrator who connected the account | No | No | No |
| `google_oauth_connections` | `connected_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Initial connection time | No | No | No |
| `google_oauth_connections` | `updated_at` | `TIMESTAMPTZ` | `NOT NULL DEFAULT now()` | Token/status update time | No | No | No |
| `google_oauth_connections` | `revoked_at` | `TIMESTAMPTZ` | Nullable, no default | Disconnect/revocation time | No | No | No |

Access tokens should normally be short-lived in server memory and refreshed as needed rather than stored persistently. A refresh-token ciphertext remains sensitive even when encrypted.

## Google Account / OAuth Model

| Model | Security and ownership | Operations and scale | Recommendation |
|---|---|---|---|
| A. Central Visave/organization Workspace account | One dedicated account, one refresh token, stable ownership when staff leave, simple audit. Compromise affects all newly created spaces. | Lowest support burden. Meet `spaces.create` is limited per authenticated user, but official quota is far above normal VSLA meeting creation volume. The central host may need `OPEN` access or named co-hosts so field operators can run the call. | **Recommended for Phase 2.** Use a dedicated organization-owned Workspace identity, not an employee's account. |
| B. Each facilitator connects Google | Natural host in Program Assisted groups. Token count, revocation, staff turnover, and support burden scale with facilitators. Does not solve Member Managed ownership. | More distributed quota but much higher operational complexity. | Not recommended initially. |
| C. Each group officer connects Google | Local ownership, but assumes Chairpersons/Record Keepers have Google accounts and can complete OAuth. Tokens and account recovery become difficult. | Poor fit for intermittent connectivity and field support. | Not recommended. |
| D. Service account with domain-wide delegation | No individual consent after Workspace admin setup, but the service account must impersonate a user; Google documents Meet REST as user authentication. Broad administrative power increases blast radius. Personal Gmail cannot use domain-wide delegation. | Scalable only where Visave controls a Google Workspace domain and its administrator approves delegation. | Optional later alternative, not V1/Phase 2 default. |
| E. Manual external link | No token or Google Cloud risk. Ownership depends on the person who created the link. | Easiest launch and fallback; weaker synchronization and account continuity. | **Recommended for Phase 1 and as permanent fallback.** |

Personal Gmail accounts can create ordinary Meet meetings, and Google's OAuth platform can be configured for external individual Google Account holders. However, consumer account limits and admin/account capability differences apply. The automatic API flow should be piloted with the exact intended account type before approval. A dedicated Workspace account is preferable for stable ownership, policy administration, co-host management, and continuity.

## Proposed User Experience

### Start Meeting page

Keep the existing **Start Meeting** page and date field. Add one compact field:

```text
Meeting mode
(*) Physical
( ) Virtual
( ) Hybrid
```

- Physical: show the group's existing meeting location as read-only context when present.
- Virtual/Hybrid in Phase 1: allow a Google Meet URL to be pasted, or allow continuing without one and completing setup on the meeting page.
- Virtual/Hybrid in Phase 2: do not call Google inside the Start Meeting submission. Start the Visave meeting normally, redirect to the meeting page, then offer **Create Google Meet**.

### Meeting page

Place a **Virtual meeting** panel after the meeting title/metadata and before **1. Attendance**.

For a ready link:

```text
Virtual meeting
Google Meet
[Join meeting] [Copy link]
```

For authorized operators on an open meeting, also show narrowly scoped controls:

- **Create Google Meet** when no link exists.
- **Paste Meet link instead** when automatic creation is unavailable.
- **Replace link** with confirmation.
- **Remove virtual link** without cancelling the financial meeting.

Do not redesign the six existing meeting workflow sections. Do not move Google controls into savings, reconciliation, or closure.

For `CLOSED` or `CANCELLED` meetings, hide the normal join action and all virtual-link mutation controls. Authorized staff may see read-only audit metadata if operationally necessary.

## Participant Access Rules

Recommended rules:

1. A link becomes visible as soon as it exists on an `OPEN` `VIRTUAL` or `HYBRID` meeting.
2. Visibility must not depend on `PRESENT` attendance. Members need the link in order to attend, so making attendance a prerequisite is circular.
3. Staff/officers use the existing group meeting-view authorization.
4. Ordinary linked members use **My Activity**, not the operational meeting workspace. Show **Join current meeting** only when:
   - the Visave user is linked to an active member in that group;
   - a `cycle_memberships` row makes the member effective for that meeting date;
   - the meeting belongs to the same group and cycle;
   - the meeting is `OPEN`; and
   - its mode is `VIRTUAL` or `HYBRID` and a link exists.
5. Never expose the URL in Find a Group, Join a Group, public metadata, unauthenticated APIs, report exports, server logs, analytics URLs, or AskVi responses that have not established group membership.
6. Do not place the raw URL in list endpoints unless the caller is authorized to join; prefer a specific authorized retrieval response.
7. Closing or cancelling the Visave meeting removes the member-facing join action immediately.

Google account ownership should not be required by Visave. Google says users can join some meetings without a Google Account, although they may need to request admission and Workspace administrator policies can restrict joining. Access behavior must be tested with the selected central account policy. See [Join a meeting](https://support.google.com/meet/answer/9303069).

### Google Meet attendance versus Visave attendance

Google Meet participation must not automatically mark Visave attendance in the initial release.

- Google Meet is the communication channel.
- `meeting_attendance` is the authoritative VSLA attendance record.
- The existing operator continues to mark `PRESENT`, `LATE`, `ABSENT`, or `EXCUSED` in Visave.
- A user can open a link and fail to join, join briefly, join from a shared device, or appear under an unrecognized name. Those facts are not equivalent to VSLA attendance.
- Future Meet conference records or participant sessions may be shown as an operator aid only after a separate privacy and accuracy review. They must not silently overwrite attendance.

## Security Model

### OAuth and token handling

- Run the authorization-code flow only in server routes.
- Request offline access so Google can return a refresh token for server-side creation when the central account holder is absent.
- Bind OAuth `state` to the signed-in Visave admin, organization, intended return path, and a short expiry. Store a one-time nonce server-side or in an encrypted, `HttpOnly`, `Secure`, `SameSite=Lax` cookie and consume it once.
- Use PKCE in addition to the web client secret where supported.
- Exchange the code only on the server and validate the exact redirect URI and issuer/identity response.
- Encrypt refresh tokens at rest with authenticated encryption such as AES-256-GCM. Keep the encryption key and version in Hostinger server environment variables, separate from the database and session secret.
- Never expose the client secret, refresh token, access token, encryption key, or raw Google error response to browser JavaScript.
- Never use `NEXT_PUBLIC_` for Google credentials or token-encryption material.
- Never store secrets in source code, GitHub, audit JSON, application logs, or public columns.
- Treat the Meet URL as confidential group access information. It is not an OAuth credential, but leakage can let outsiders attempt to join.
- Sanitize audit values so tokens are not recorded. The current audit sanitizer already removes keys containing `token` or `secret`; new integration code must retain that behavior.

Google's web-server OAuth guidance requires CSRF protection with `state` and explains offline refresh tokens: [Using OAuth 2.0 for Web Server Applications](https://developers.google.com/identity/protocols/oauth2/web-server). Meet's authentication guide states that Meet REST operations use user authentication and documents domain-wide delegation: [Authenticate and authorize Meet REST API requests](https://developers.google.com/workspace/meet/api/guides/authenticate-authorize).

### Disconnect and authorization expiry

- **Disconnect:** call Google's token revocation endpoint when possible, securely erase the stored refresh-token ciphertext, set the connection to `REVOKED`, and audit the actor/time.
- **Expired access token:** refresh server-side and retry the Google request once.
- **Invalid/revoked refresh token:** mark `REAUTH_REQUIRED`, stop automatic calls, and tell an authorized administrator to reconnect the central Google account.
- Existing Meet links remain stored because revoking OAuth does not erase already created spaces. Operators may use a manual replacement if a link stops working.
- Reauthorization must never be offered to ordinary group members or expose a connection belonging to another organization.

## Failure Handling

| Scenario | Safe Visave behavior |
|---|---|
| Google API unavailable or times out | Keep the Visave meeting unchanged. Show a retryable error and manual-link fallback. Use short timeouts and bounded exponential backoff; never hold a financial DB transaction open. |
| Access token expired | Refresh server-side, retry once, and avoid duplicate creation through a meeting row lock and idempotency record/state. |
| Refresh token expired or user revoked access | Mark the organization connection `REAUTH_REQUIRED`; preserve existing links; require an authorized administrator to reconnect. |
| Link creation fails | Leave `virtual_meeting_url` and `google_meet_space_name` null. The meeting remains usable for physical operations and financial records. |
| Google succeeds but the Visave update fails | Record enough request context to reconcile safely, attempt `spaces.get` before creating another, and surface an administrator recovery path. Do not blindly create multiple spaces. |
| Link exists and Visave meeting is cancelled | Hide the link immediately. If a conference is active, offer a best-effort `endActiveConference` action; do not make meeting cancellation depend on Google. The Meet API has no space-delete method. |
| Virtual meeting changes to physical | Allow only an authorized operator while the meeting is open. Clear the current exposed URL/space fields after confirmation and record old/new values in `audit_logs`. Do not touch financial data. |
| Link is regenerated | Create the replacement first; update the row only after success; retain old/new values in audit; remove the old link from all member views and future notifications. |
| Meeting is closed | Closing must remain a local Visave operation. Hide join/create/replace controls. A best-effort Google conference-end call may run separately after closure but may not block or roll back closure. |
| Duplicate creation attempt | Lock the meeting row, return the existing link when present, use a client idempotency key, and enforce partial uniqueness for the URL and space name. |
| Unauthorized officer attempts creation | Return the normal authorization denial. Box Keeper and Money Counters do not gain link-management rights merely because they are officers. |
| Central host account disabled | Mark the connection unavailable, reconnect a replacement organization account, and regenerate links only for still-open meetings after explicit confirmation. |
| User's internet connection is unavailable | The create/join action fails gracefully; the current meeting and local financial state remain intact. Do not claim that Google Meet can operate offline. |

## Offline Considerations

- Creating a Meet space requires internet access from the Visave server to Google and valid Google authorization.
- Joining Google Meet requires internet connectivity and a supported browser/app/device.
- Automatic creation cannot be queued as a financial transaction. At most, queue a separate idempotent communication task with an obvious `pending` state.
- A previously retrieved link can be displayed from a future offline cache, but clicking it still requires internet. The current repository has no implemented service worker or offline cache despite public roadmap copy mentioning offline capabilities, so V1 must not promise offline link display.
- If an operator loses connectivity after starting a Visave meeting, they should be able to continue once Visave itself reconnects and then retry link creation or paste a previously created link.
- Future offline synchronization must resolve by meeting ID, never create multiple spaces on replay, and must not couple Meet state to ledger synchronization.

## Hostinger Deployment Requirements

Phase 1 manual links require no Google environment variables.

Phase 2 automatic creation requires server-only configuration such as:

- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_OAUTH_REDIRECT_URI`
- `GOOGLE_TOKEN_ENCRYPTION_KEY`
- optionally `GOOGLE_TOKEN_ENCRYPTION_KEY_VERSION`

Deployment requirements:

- Store values in Hostinger's server environment configuration, not source or `NEXT_PUBLIC_` variables.
- Confirm the Hostinger plan permits outbound HTTPS to `oauth2.googleapis.com` and `meet.googleapis.com` and preserves environment values across deployments.
- Use the existing server-side Next.js route model for authorization callbacks and Google calls.
- Production callback should be an exact HTTPS URI, proposed as `https://visave.gidacare.com/api/v1/integrations/google/callback`.
- Local callback may be `http://localhost:3000/api/v1/integrations/google/callback`.
- Add both exact callback URIs to the Google OAuth web client. Redirect matching is exact; do not use wildcards.
- Keep the existing `APP_URL` authoritative for internal return URLs, but validate rather than trust arbitrary callback parameters.
- Protect the callback from CSRF, open redirects, organization switching, and replay.

## Google Cloud Setup

For the recommended Phase 2 Meet REST approach:

1. Create separate Google Cloud projects for Visave testing and production, or formally select owned projects for each environment.
2. Ensure the production project and dedicated Google account are controlled by the organization, not an individual staff member.
3. Enable the **Google Meet REST API**. Do not enable Calendar solely for this phase.
4. Configure the Google Auth Platform branding, audience, data access scopes, and contact information.
5. If only a central account in an owned Workspace domain will connect, evaluate an **Internal** audience. Otherwise use **External**, add test users during pilot, and plan sensitive-scope verification before general production use.
6. Verify ownership of `gidacare.com` and provide the required home page, privacy policy, terms/support information, and accurate Visave branding.
7. Add the minimum scopes listed below.
8. Create an OAuth 2.0 client of type **Web application**.
9. Add the exact localhost and production redirect URIs.
10. Configure the credentials and token-encryption key in the corresponding Hostinger environment.
11. Connect the dedicated organization account through a Visave admin-only settings screen.
12. Test create, get, patch, co-host membership where needed, token refresh, revocation, and `endActiveConference` with the selected Workspace edition and its admin policies.
13. Test joining from Android, low-bandwidth networks, personal Google accounts, and without a Google account.
14. Review Google OAuth verification status before production. Sensitive scopes may require verification; Testing/External apps have user and token-lifetime limitations. See [OAuth app state overview](https://developers.google.com/identity/protocols/oauth2/production-readiness/overview) and [sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification).

## OAuth Scopes

Minimum Phase 2 scopes:

| Scope | Why needed |
|---|---|
| `https://www.googleapis.com/auth/meetings.space.created` | Create Meet spaces and read/modify spaces created by Visave. The same scope supports member/co-host management for those spaces. It is classified by Google as sensitive. |
| `openid` | Obtain a stable authenticated Google subject for the central connection. |
| `email` | Display and audit which organization-owned Google account is connected. |

Do not request:

- full Calendar access;
- Drive or Gmail access;
- Meet recordings/transcripts scopes;
- `meetings.space.readonly` for spaces created outside Visave;
- `meetings.space.settings` when `meetings.space.created` is sufficient for Visave-created spaces.

If Phase 3 intentionally adds Calendar invitations, request `https://www.googleapis.com/auth/calendar.events.owned` incrementally and explain that it permits creating and managing events on calendars the connected user owns. Do not pre-authorize it in Phase 2. See [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).

## Cost / Quota Considerations

API quota and Google Meet product limits are different.

### Meet REST API quota

Google's current [Meet API usage limits](https://developers.google.com/workspace/meet/api/guides/limits) list:

- `spaces.create` reduced writes: 100 per minute per project and 10 per minute per user per project.
- Other writes: 1,000 per minute per project and 100 per minute per user per project.
- Reads: 6,000 per minute per project and 600 per minute per user per project.
- Standard use is currently documented as no additional cost, with charges for exceeding quota limits planned later in 2026. Pricing and billing status must be rechecked immediately before implementation because this policy is changing.

Normal VSLA usage should be far below these limits. A central account is practical, but the application should still use exponential backoff for `429` responses and prevent rapid duplicate clicks.

### Calendar quota

Calendar is not recommended in Phase 2. If adopted later, Google's current [Calendar usage limits](https://developers.google.com/workspace/calendar/api/guides/quota) document project and per-user quotas plus operational limits on rapid writes to one calendar. Every virtual meeting would create a Calendar event in that architecture; a central calendar could become an operational bottleneck even before project quota is reached.

### Meet account/product limits

Product limits depend on the organizer's account or Workspace edition, not the API quota. Google's current Meet help documents a 100-participant baseline and a 60-minute limit for group meetings hosted without a Meet subscription, while eligible Workspace editions support different participant counts and longer meetings. See [Learn about features in Google Meet](https://support.google.com/meet/answer/13396001) and [Meet requirements](https://support.google.com/meet/answer/7317473). Do not hard-code these limits in Visave; verify the chosen central account's current edition and policies.

Members do not all need Google accounts merely for Visave authorization. Actual Meet admission can still depend on the organizer's account, space access type, Workspace policy, and whether the participant is signed in.

## Migration Plan

The latest migration on this analysis branch is `039_cycle_member_participation.sql`. The approved `feature/twilio-meeting-summary` branch already reserves `040_twilio_meeting_summary_notifications.sql` and `041_twilio_trial_provider_recipient.sql`.

The migration runner sorts all `.sql` filenames, applies each filename not already recorded in `schema_migrations`, and does not require contiguous numbering. Reserve the following filename for Google Meet Phase 1:

`050_virtual_meeting_metadata.sql`

This intentionally leaves `042` through `049` available for other work and avoids a collision with the Twilio migrations.

Proposed contents:

1. Add `meeting_mode VARCHAR(10) NOT NULL DEFAULT 'PHYSICAL'` with the three-value check.
2. Add nullable `virtual_meeting_url TEXT`.
3. Add nullable `google_meet_space_name VARCHAR(255)`.
4. Add consistency checks described above.
5. Add partial unique indexes on non-null canonical URLs and non-null Google space names.
6. Do not update historical rows manually; the default makes every existing meeting `PHYSICAL` and leaves virtual fields null.

This migration is backward-compatible with current pages, services, reports, and financial relationships. Reports may later display meeting mode, but report calculations must remain unchanged.

Before Phase 2, add a separate later migration—provisionally `051_google_oauth_connections.sql`—only after the central-account OAuth design and encryption/key-rotation process are approved.

Before creating any Google Meet migration, implementation must inspect the latest migration numbers in `main` and in every already-approved feature branch expected to merge, particularly `feature/twilio-meeting-summary`. A Google Meet migration must never reuse an existing migration number; if `050` or `051` has been assigned by implementation time, select the next unused number instead.

## Implementation File Map

No files below are changed by this analysis. They are the likely future implementation surface.

### Database

- `database/migrations/050_virtual_meeting_metadata.sql` — new meeting columns/checks/indexes.
- `database/migrations/051_google_oauth_connections.sql` — deferred organization connection table for Phase 2.

### Services

- `src/modules/meetings/meeting.service.js` — accept mode, store/manual replace metadata, enforce open-state and audit behavior.
- `src/modules/meetings/meeting.repository.js` — retrieve authorized virtual metadata with meetings.
- `src/modules/member-self/member-self.service.js` — expose only the current eligible member's join action.
- New `src/modules/integrations/google-meet.service.js` — token refresh and Meet API calls isolated from financial services.
- New `src/modules/integrations/google-oauth.repository.js` — encrypted organization connection persistence.

### API

- `src/app/api/v1/groups/[id]/meetings/route.js` — accept meeting mode during Start Meeting.
- `src/app/api/v1/groups/[id]/meetings/[meetingId]/route.js` — return authorized mode/link state.
- New `src/app/api/v1/groups/[id]/meetings/[meetingId]/virtual-session/route.js` — create, paste, replace, or remove link with `MEETING_OPERATE`.
- `src/app/api/v1/me/groups/[id]/activity/route.js` — member-safe current join metadata.
- New admin-only Google connect/callback/disconnect routes under `src/app/api/v1/integrations/google/`.

### UI

- `src/app/(protected)/groups/[id]/meetings/new/page.js`.
- `src/components/start-meeting-form.js`.
- `src/app/(protected)/groups/[id]/meetings/[meetingId]/page.js`.
- Prefer a new small `src/components/virtual-meeting-panel.js` rather than expanding financial controls in `meeting-mode.js`.
- `src/app/(protected)/my-groups/[id]/my-activity/page.js` for ordinary member joining.
- An admin settings surface for central Google connection status in Phase 2.

### Validation

- `src/modules/meetings/meeting.schemas.js` — meeting mode and strict Meet URL validation.
- New integration validation for OAuth callback state and link-management requests.

### Authorization

- `src/modules/group-access/group-access.service.js` — reuse `MEETING_OPERATE` and existing view logic; add no broader role.
- `src/modules/group-access/group-access.repository.js` — only if member join context needs a reusable resolver.
- `src/modules/member-self/member-self.service.js` — enforce linked membership and effective cycle participation for ordinary members.

### Tests

- `tests/phase2b.test.js` — validation and physical default regression.
- `tests/group-access.test.js` — operator matrix and denied officer/member cases.
- `tests/member-self-service.test.js` — current participant link visibility and cross-group denial.
- New `tests/google-meet-integration.test.js` — API adapter, token/error, duplicate, and audit behavior.
- Relevant Phase 2B and member-self acceptance scripts for database lifecycle coverage.

### Configuration

- `.env.example` — Phase 2 variable names only, never values.
- Hostinger environment settings.
- Google Cloud Auth Platform and Meet API configuration.
- `package.json` only if an approved Google client library is chosen; direct server-side `fetch` can avoid a new dependency.

## Test Plan

### Database and backward compatibility

- Existing rows migrate to `PHYSICAL` with null virtual fields.
- Existing physical Start Meeting behavior, attendance snapshots, one-open-meeting rule, closure, cancellation, reports, and ledger behavior remain unchanged.
- `PHYSICAL`, `VIRTUAL`, and `HYBRID` validation accepts only canonical values.
- Duplicate canonical Meet URLs and Google space names are rejected safely.
- Invalid/non-Google/phishing URLs are rejected.

### Authorization

- Scoped program admins can manage a link only within scope.
- Assigned active facilitator can manage links in Program Assisted groups.
- Facilitator is view-only in Member Managed groups.
- Chairperson behavior matches current meeting-operation authority.
- Record Keeper is view-only in Program Assisted and operational in Member Managed.
- Box Keeper, Money Counters, inactive/former officers, ordinary members, and cross-group users cannot create, replace, remove, or cancel a virtual session.
- Ordinary current members can retrieve only their group's current open meeting link through member self-service.
- Public and unauthenticated endpoints never return the URL.

### Manual link phase

- Virtual and hybrid meetings accept a canonical manual Meet URL.
- Physical meetings do not expose a virtual link.
- Link replacement is confirmed and audited.
- Closed/cancelled meetings reject link mutation and hide member join controls.

### Automatic phase

- Valid central OAuth connection creates one Meet space and stores `meetingUri` plus `space.name`.
- Concurrent clicks and retries return the same current session rather than creating duplicates.
- Google timeout, `429`, `5xx`, malformed response, and network failure do not change financial rows or meeting state.
- Expired access token refreshes once.
- Revoked refresh token marks reauthorization required without deleting existing links.
- Successful Google creation followed by DB failure enters a recoverable reconciliation path rather than blind recreation.
- Host account replacement is audited.
- Cancellation hides link even if `endActiveConference` fails.

### Financial isolation

- Savings, Social Fund, fines, loans, repayments, reversals, ledger balances, reconciliation, signature, share-out, and report calculations are identical across physical, virtual, and hybrid modes.
- Google calls are not made inside financial, reconciliation, close, or cancellation database transactions.
- A Google outage does not prevent marking attendance, reconciling, or closing an otherwise valid Visave meeting.
- Database rollback tests prove that partial Meet metadata cannot create or reverse financial entries.

### User experience

- Join button is visible before attendance is marked.
- The link opens in a new safe browser context and Copy Link works.
- Mobile/narrow views do not expose raw URLs beyond the authorized panel.
- Clear pending, retry, reconnect-required, removed, closed, and cancelled states are shown.
- Slow and offline paths do not submit duplicate requests.

## Phased Rollout

### Phase 0 — policy and pilot decisions

- Confirm who owns the central Workspace account.
- Confirm Meet edition, access policy, co-host needs, and whether `OPEN` access is acceptable.
- Decide whether ordinary linked members should receive the link in **My Activity** or only through operator distribution.

### Phase 1 — mode plus manual link

- Migration 040.
- Add Physical/Virtual/Hybrid to Start Meeting.
- Add validated manual link, Join, Copy, Replace, and Remove controls.
- Add member-safe link visibility and audit events.
- No Google Cloud credentials, Calendar, OAuth, or notifications.

### Phase 2 — automatic Meet space creation

- Add organization-level OAuth connection and encrypted refresh-token storage.
- Enable Meet REST API.
- Add central account connect/disconnect and `spaces.create`.
- Retain manual fallback.
- Add bounded retry/idempotency/recovery behavior.

### Phase 3 — pre-meeting notifications and optional scheduling decision

- Use the existing in-app `notifications` model first.
- The inspected repository contains no current Twilio, SMS, or WhatsApp implementation or dependency. Any future outbound channel should be a separate notification subsystem.
- Pre-meeting invitations are distinct from post-meeting summaries and must remain separate queues/templates/events.
- Only if advance scheduling is approved should Visave add scheduled timestamps/timezone and evaluate Calendar API `conferenceData` plus `calendar.events.owned`.
- AskVi may explain how to join or surface an already authorized action, but must not reveal a raw link without authenticated group-member context.

The current notification architecture is an in-app `notifications` table keyed to a Visave user. A future `MEETING_VIRTUAL_LINK_READY` notification can point to an authorized Visave page rather than embedding the raw URL. SMS, WhatsApp, and email should be separate delivery adapters and should resolve current link state at send time so a regenerated link is not distributed. Post-meeting summaries and pre-meeting link notifications are different events, templates, consent rules, and retry queues; they should remain separate.

### Phase 4 — optional analytics

- Evaluate conference records/participant sessions only after privacy, consent, retention, account edition, and OAuth scope reviews.
- Do not replace Visave attendance. At most, use Meet data as a reconciliation aid labeled as non-authoritative.
- Do not request Drive/recording/transcript scopes unless a separately approved feature requires them.

## Risks / Open Questions

Human decisions required before implementation:

1. Does CCCRN/Visave own a Google Workspace domain and a dedicated account that can remain the long-term organizer?
2. Should the Meet space be `OPEN`, or should members knock/be invited? `OPEN` improves access in low-support settings but increases link-leakage risk.
3. Which current actors may see the link: all linked current participants, or only Chairperson/Record Keeper/facilitator with separate distribution?
4. Do group officers have reliable email/Google identities if they are to be assigned as co-hosts?
5. Is a meeting link required before the Visave meeting starts? If yes, Visave needs a genuine scheduled-meeting lifecycle rather than only new columns on an open meeting.
6. Should a manual link be permitted permanently, or only as an outage fallback after automatic creation launches?
7. Is one central Google account sufficient for governance and quota, or must ownership be separated by project/state/organization?
8. What retention policy applies to closed-meeting URLs and Google resource identifiers?
9. Does Hostinger permit the required outbound requests and secure environment/key rotation on the selected plan?
10. Is OAuth sensitive-scope verification required for the selected Google Auth audience, and who owns the privacy-policy/verification process?
11. Should Visave ever call `endActiveConference` automatically, or should closure only hide the join link and leave Google host controls independent?
12. What member consent and privacy notice is required before any future Meet participant analytics are collected?

Primary risks:

- a leaked Meet URL admits unintended participants;
- a central account compromise affects many groups;
- OAuth refresh-token theft enables unauthorized API actions;
- a disabled or departed-account owner breaks future link creation;
- retries create orphan/duplicate spaces without idempotency and recovery;
- Google policies or Workspace admin settings differ from test behavior;
- users confuse Meet presence with authoritative Visave attendance;
- adding scheduling implicitly changes the current meeting lifecycle;
- coupling Google calls to meeting/financial transactions harms availability and integrity.

## Final Recommended Architecture

Adopt `PHYSICAL`, `VIRTUAL`, and `HYBRID` as communication modes on `vsla_meetings`, defaulting all existing and unspecified meetings to `PHYSICAL`. Store one current, canonical Google Meet URL directly on the meeting and optionally the immutable Meet `space.name` when Visave creates it. Use audit logs for link history. Do not add scheduling fields, Calendar event IDs, duplicated meeting codes, or a session table in the first release.

Launch with manual links. Then add direct Meet REST `spaces.create` using one dedicated, organization-owned Workspace account connected with server-side OAuth. Use the single `meetings.space.created` Google API scope plus basic OpenID identity scopes. Keep tokens encrypted and server-only. Reuse the existing Visave `MEETING_OPERATE` rules for link management and the member self-service membership resolver for ordinary member joining.

Visave attendance remains authoritative. Google Meet is only the communication channel. Every Google operation is isolated from financial and meeting-close transactions, and every failure has a retry/manual fallback.

```text
Authorized Visave operator
          |
          v
Start Meeting (existing Visave flow)
          |
          +------> PostgreSQL
          |          - OPEN meeting
          |          - attendance snapshot
          |          - mode/link metadata
          |
          v
Virtual Meeting panel
          |
          +------> Manual Meet URL (Phase 1)
          |
          +------> Visave server (Phase 2)
                        |
                        +------> Encrypted organization OAuth connection
                        |
                        +------> Google Meet REST API: spaces.create
                                      |
                                      v
                              space.name + meetingUri
                                      |
                                      v
                          Authorized Visave meeting/member view
                                      |
                                      v
                                 Google Meet

Google Meet presence ----------------X----------------> Visave attendance
                                      (no automatic equivalence)
```
