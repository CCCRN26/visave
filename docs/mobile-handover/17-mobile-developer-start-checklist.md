# Mobile developer start checklist

This is the recommended implementation order for a member-first app. The two native-login blockers may be investigated in parallel with mocked screen work, but must close before the integrated login milestone is accepted.

## Before coding

- [ ] Read `00-README.md`, `01-system-architecture.md`, `03-authentication-and-sessions.md`, `05-role-permission-matrix.md`, and `15-mobile-backend-gaps.md`.
- [ ] Confirm Android-only versus Android+iOS and record all 12 decisions in `16-open-decisions.md`.
- [ ] Obtain written approval for **MEMBER-FIRST** V1 and an explicit list of excluded operator features.
- [ ] Have operations confirm the staging base URL, TLS certificate, deployed revision, test window, and data-reset policy.
- [ ] Receive only the required synthetic staging accounts through an approved secret-sharing channel; never request server secrets.
- [ ] Confirm who owns backend, mobile, security, QA, product acceptance, and incident response.
- [ ] Agree how API/backend changes will be versioned and communicated; the current routes use `/api/v1` but no generated OpenAPI client exists.

## Close the authentication design gates

- [ ] Select and threat-model the native Turnstile challenge/token flow. Preserve Siteverify, action, hostname, expiry, and failure behavior.
- [ ] Select cookie session or a backend mobile-token contract.
- [ ] If retaining cookies, prove `Set-Cookie` capture, HttpOnly/Secure handling, app-restart restoration, expiry, server revocation, deletion, and authenticated file download on every supported platform.
- [ ] If adding mobile tokens, wait for a documented backend contract; do not invent bearer authentication client-side.
- [ ] Confirm secure-device storage, local-data clearing, backup exclusions, redacted logging, and rooted/jailbroken-device posture.
- [ ] Document the outcome and attach physical-device staging evidence.

## Project setup

- [ ] Create an Expo-managed React Native TypeScript project after decision approval.
- [ ] Configure separate local/staging/production build profiles with `EXPO_PUBLIC_API_BASE_URL`; validate allowed HTTPS origins at startup.
- [ ] Add Expo Router and a top-level auth/forced-password/app navigation state machine.
- [ ] Add a single API client that supports the finalized credential transport, JSON envelopes, binary responses, timeouts, cancellation, and redaction.
- [ ] Add a server-state layer such as TanStack Query with conservative caching and focus/reconnect refresh.
- [ ] Add centralized handling for validation details, 401, `PASSWORD_CHANGE_REQUIRED`, 403, 404, 409, 429, and safe 5xx/offline errors.
- [ ] Add a money display helper that formats server-provided decimal strings without authoritative arithmetic.
- [ ] Add accessibility, localization/readability, slow-network, and low-memory baselines.
- [ ] Configure production builds without verbose request/state logging.

## First vertical slice

- [ ] Implement login with email, password, and the approved Turnstile token flow.
- [ ] Implement forced password change: detect `user.mustChangePassword`/the protected-route error, require 12–128 characters and confirmation, then refresh session identity.
- [ ] Implement session restoration with `GET /api/v1/auth/me`.
- [ ] Implement logout with `POST /api/v1/auth/logout`, followed by complete local user-data cleanup.
- [ ] Implement My Groups with `GET /api/v1/me/groups`.
- [ ] Implement member activity with `GET /api/v1/me/groups/{id}/activity` and server-returned summaries.
- [ ] Implement meeting list/detail and external Google Meet launch only when the detail response supplies `joinUrl`.
- [ ] Exercise the slice on physical devices with `MEMBER_TEST` and `FORCED_PASSWORD_MEMBER_TEST`.

## Complete member V1

- [ ] Present savings, Social Fund, fine, loan/repayment, and share-out history from self-service DTOs; do not derive ledger truth.
- [ ] Implement loan self-request only where the server activity/meeting context permits it; omit `memberId` for the ordinary member and use the exact schema.
- [ ] Implement loan-request cancellation with its required reason and refresh authoritative state.
- [ ] Implement in-app notification list, mark-one-read, and mark-all-read; do not imply native push exists.
- [ ] Implement own Google Meet email GET/PATCH if product scope includes it.
- [ ] Add optional authenticated PDF viewing/sharing only after secure binary/session tests; defer Excel by default.
- [ ] Add profile content from authenticated identity/current DTOs; do not assume a general profile-update API exists.

## Offline policy

- [ ] Cache only read DTOs needed for useful snapshots, with user ID/tenant separation and last-updated labels.
- [ ] Revalidate session and visible data on foreground/reconnect/pull-to-refresh.
- [ ] Disable all financial and workflow mutations while offline.
- [ ] Never queue attendance, savings, Social Fund, fines, loan decisions/disbursement/repayment, reversal, reconciliation, close, or share-out.
- [ ] On uncertain mutation outcome, fetch authoritative state before allowing another action.

## Testing and security gate

- [ ] Run the full cases in `13-staging-and-testing.md`, including negative role/scope checks.
- [ ] Verify logs, crash reports, screenshots, notifications, storage, clipboard and backups contain no credential/PII leakage.
- [ ] Verify duplicate taps, timeout-after-send, stale 409 state, 429, session expiry, password reset, and account deactivation behavior.
- [ ] Verify a member cannot substitute another member/group/cycle/meeting identifier to gain access.
- [ ] Verify every hidden/disabled capability is also rejected by the server when called directly.
- [ ] Obtain backend/security sign-off for Turnstile, credential transport, distributed abuse protection, and durable private storage.
- [ ] Obtain product acceptance against the written member-first scope before a store/pilot build.

## Later operator phase (do not silently include in V1)

- [ ] Re-read the PA/MM action matrix and test current officer effective dates on every operator screen.
- [ ] Treat Chairperson/Record Keeper as cycle assignments, not system roles.
- [ ] Design explicit confirmation and online-only handling for financial posts, reversals, reconciliation/signature, close, loan decisions/disbursement, and share-out.
- [ ] Preserve server actor attribution and same-loan SOD; never enable an action from client role guesses.
- [ ] Add facilitator/admin/assisted-reset screens only through separate threat model and acceptance criteria.

## Branding handover

Reusable public assets are `public/visave-logo.png`, `public/visave-logo.jpeg`, `public/single-visave-logo.png`, `public/visave-fav.png`, `public/cccrn-logo.png`, and `public/images/vsla-community-hero.png`. Confirm licensing/brand-owner approval before packaging CCCRN or photographic assets in a distributed app.

Core light palette from `src/app/globals.css`:

| Token | Value |
|---|---|
| Brand 950 / 900 / 800 | `#071f20` / `#0b292a` / `#123536` |
| Brand 700 / 600 / 500 | `#174b43` / `#087443` / `#149461` |
| Accent 500 / 400 | `#eaaa35` / `#f2b84b` |
| Background / panel | `#f4f7f5` / `#ffffff` |
| Text / muted | `#15241d` / `#637269` |
| Danger / info | `#a93c3c` / `#246e91` |

The web font stack is `Inter, "Segoe UI", Arial, sans-serif`. No reusable icon dependency was found; current navigation/dashboard icons are inline SVG. Native layouts may adapt to small screens and platform conventions while retaining product identity: dark green foundation, gold accent, clear status colors, rounded panels, readable financial numerals, strong focus/contrast, and explicit empty/error states. Do not scrape web CSS into React Native.

## Handover material to keep at hand

- API truth: `04-api-catalog.md`
- Error decoder: `09-errors-and-status-codes.md`
- Screens and request mapping: `08-mobile-screen-map.md`
- Security review: `14-security-guidelines.md`
- Sanitized request runner: `visave-mobile.postman_collection.json`
- Backend source anchors: `src/app/api/**/route.js`, domain schemas/services/repositories under `src/modules/`, auth under `src/lib/auth/`

