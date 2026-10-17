# Integrations

This chapter describes only integration behavior that exists in the current server. All provider credentials and privileged calls remain on the server.

## Cloudflare Turnstile

Turnstile protects both login and assisted password reset when `TURNSTILE_ENABLED=true`.

| Concern | Current behavior |
|---|---|
| Client configuration | The web client reads `NEXT_PUBLIC_TURNSTILE_SITE_KEY` and loads Cloudflare's browser widget. |
| Server secret | `TURNSTILE_SECRET_KEY`; server only. |
| Actions | `login` and `assisted_password_reset`; the returned action must match the endpoint. |
| Hostnames | `TURNSTILE_ALLOWED_HOSTNAMES` is a required comma-separated allow-list whenever verification is enabled. |
| Verification | The server posts URL-encoded `secret` and `response` to Cloudflare Siteverify, with a five-second timeout. |
| Token rules | Required when enabled; trimmed; maximum 2,048 characters. Tokens are not reusable credentials and must not be logged. |
| Failures | Missing: `TURNSTILE_REQUIRED`/400. Failed or mismatched proof: `TURNSTILE_INVALID`/400. Provider transport or malformed response: `TURNSTILE_UNAVAILABLE`/503. Bad configuration: `TURNSTILE_CONFIGURATION_ERROR`/503. |
| Test mode | `TURNSTILE_TEST_MODE=true` works only outside production and only with one of Cloudflare's recognized dummy secrets. This is a server/staging setting, not a client bypass. |

### Native consequence

The current token-producing component is browser-specific: it loads Cloudflare JavaScript and renders a DOM-based widget. A native React Native/Expo screen cannot produce the required token from that component directly.

**Native login requires a mobile-specific Turnstile flow, such as a tightly controlled WebView/browser challenge with an approved hostname and a safe token hand-off, or a revised authentication design agreed with the backend team.** The existing verification must not be bypassed or weakened. This is a blocker before a real native login can ship.

Source: `src/lib/security/turnstile.js`, `src/components/turnstile-widget.js`, `src/app/api/v1/auth/login/route.js`, `src/app/api/v1/users/[id]/assisted-password-reset/route.js`.

## Google OAuth and Google Meet

### What exists

- `GET /api/v1/integrations/google/connect` begins an administrator/operator browser OAuth flow and redirects to Google.
- `GET /api/v1/integrations/google/callback` validates the OAuth state and completes the redirect flow.
- `POST /api/v1/integrations/google/disconnect` removes the organization's connection.
- `POST` and `DELETE /api/v1/groups/{id}/meetings/{meetingId}/google-meet` create/update or remove meeting-space data for an authorized operator.
- `PATCH /api/v1/me/google-meet-email` lets the signed-in user set their own Google Meet email.
- Member meeting detail returns `joinUrl` only for an `OPEN` meeting whose type is `VIRTUAL` or `HYBRID` and whose stored URL is valid.

The configured access type is `TRUSTED` by default and may be `TRUSTED` or `RESTRICTED`; `OPEN` is rejected. OAuth client secrets, refresh tokens, and the Google-token encryption key never belong in the app.

### Mobile behavior

Member V1 only needs to receive the authorized `joinUrl` from the member meeting-detail response and open it using the operating system. Treat the URL as short-lived UI data: do not infer meeting access from a cached URL, and refresh the meeting before joining. Support both the installed Google Meet app and browser fallback. The OAuth connect/callback routes are browser redirect workflows and are **not member-mobile APIs**.

NEEDS CONFIRMATION: the product owner must decide whether app/universal-link configuration is required beyond external URL launch.

Source: `src/modules/google-integration/google-config.js`, `src/modules/google-integration/google-meet.service.js`, `src/app/api/v1/integrations/google/**`, `src/app/api/v1/groups/[id]/meetings/[meetingId]/google-meet/route.js`, `src/modules/member-meetings/member-meeting.service.js`.

## Twilio meeting-summary SMS

SMS is entirely server-side. Meeting close writes notification/outbox work in the server transaction and invokes the post-commit notification processor. The mobile app does not call Twilio and must never receive its Account SID, auth token, sender number configuration, or trial-recipient list.

The current provider implementation is deliberately trial-restricted. Submission is allowed only when SMS and trial mode are enabled, configuration is valid, the recipient is allow-listed, and the exact configured template/from-number are used. There is no mobile-facing SMS status endpoint.

Mobile implication: closing a meeting may trigger server-side SMS processing, but the response must not be interpreted as carrier delivery confirmation. Do not add a client-side resend button without a new backend contract.

Source: `src/lib/notifications/twilio.js`, `src/modules/notifications/meeting-notification.service.js`, `src/modules/meetings/meeting.service.js`.

## In-app notifications

The application stores in-app notifications in PostgreSQL. An authenticated recipient may:

- list their latest 100 notifications with `GET /api/v1/notifications`;
- mark one of their own rows read with `PATCH /api/v1/notifications/{id}/read`;
- mark all their rows read with `POST /api/v1/notifications/read-all`.

Ownership is enforced by the server/SQL recipient condition; never use locally cached user identity as authorization. The list is not cursor-paginated.

### Native push status

**Does Visave currently support mobile push notifications? NO.** There is no device-registration endpoint, push-token table, Expo/FCM/APNs provider, preference model, or invalid-token cleanup flow in the inspected code.

If push is selected later, backend/infrastructure work is required for authenticated device registration, platform/token metadata, token rotation and revocation, preferences, provider delivery, safe deep-link payloads, observability, and logout/account-disable cleanup. Until then, poll/revalidate the in-app notification endpoint while the app is active and on user refresh.

Source: `src/modules/notifications/notification.service.js`, `src/modules/notifications/meeting-notification.repository.js`, `src/app/api/v1/notifications/**`, database notification migrations.

## Integration ownership summary

| Integration | Mobile may receive/use | Must remain server-side | Mobile readiness |
|---|---|---|---|
| Turnstile | Site key and a valid challenge result once a native flow is approved | Secret, hostname/action validation, Siteverify call | **Blocked for native login design** |
| Google Meet | Authorized member `joinUrl`; user's own Meet email | OAuth client secret, refresh tokens, token-encryption key, space creation | Join is ready with external-launch caveat |
| Twilio | No direct provider data | All credentials and provider calls | No client work required |
| In-app notifications | Own notification DTOs and read mutations | Recipient selection and authorization | Ready with no push/background delivery |

## Known risks / inconsistencies

- A web Turnstile widget is not evidence that a native challenge flow works.
- Google OAuth routes return redirects rather than normal JSON, so the Postman/mobile API classification differs from the member join-link path.
- Meeting close and provider delivery are different events; there is no mobile-visible delivery-status contract.
- In-app notification delivery and native push are separate capabilities. Only the former exists.

