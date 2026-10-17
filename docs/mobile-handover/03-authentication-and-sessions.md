# Authentication and sessions

## Current auth model

Email/password authentication creates a custom opaque session. It is not NextAuth/Auth.js and is not a JWT.

```mermaid
sequenceDiagram
  participant App as Client
  participant API as POST /api/v1/auth/login
  participant CF as Cloudflare Turnstile
  participant DB as PostgreSQL
  App->>API: email, password, turnstileToken
  API->>CF: Siteverify token/action
  CF-->>API: verified + action + hostname
  API->>DB: verify bcrypt hash; store SHA-256(token), expiry
  API-->>App: Set-Cookie vsla_session; user JSON
  App->>API: Cookie on later requests
  API->>DB: hash cookie and resolve active session/user/roles/permissions
```

### Login contract

`POST /api/v1/auth/login`, JSON:

```json
{
  "email": "member@example.invalid",
  "password": "<PASSWORD>",
  "turnstileToken": "<VALID_TURNSTILE_TOKEN>"
}
```

- Email: trimmed, lowercased, valid email.
- Password: 8–128 characters at login (creation/change policy is 12–128).
- Turnstile token: optional in Zod only because the server verifier decides based on configuration; required when Turnstile is enabled.
- Rate limit: 10 attempts per 15 minutes, keyed by first `x-forwarded-for` address or `unknown`; process-memory only.
- Success: `200`, `{success:true,data:{user:{id,organization_id,first_name,last_name,email,phone,status,must_change_password}}}` plus `Set-Cookie`.
- Invalid user/status/password: `401 AUTHENTICATION_REQUIRED`, message `Invalid email or password`.
- Failed and successful logins are audited. Failed audit includes attempted email and reason, but never password.

### Session token and cookie

| Property | Value |
|---|---|
| Token | 32 cryptographically random bytes encoded base64url |
| Server storage | SHA-256 hash only in `user_sessions.token_hash` |
| Cookie | `vsla_session` |
| HttpOnly | `true` |
| Secure | `true` when `NODE_ENV === "production"`; otherwise false |
| SameSite | `lax` |
| Path | `/` |
| Domain | not set (host-only) |
| Expiry | absolute time, 8 hours from login |
| Sliding renewal | none found |
| `last_used_at` update | none found |
| Validation | unrevoked, unexpired session; active user |
| Concurrent sessions | allowed |

### Session restoration

Call `GET /api/v1/auth/me` with the cookie. Normal success is `{success:true,data:{user:{... roles:[],permissions:[],session_id}}}`. A forced-change session returns `403 PASSWORD_CHANGE_REQUIRED`, not user JSON. The login response itself contains `must_change_password`, so route directly to the forced-change screen before calling `/auth/me`.

### Logout and revocation

`POST /api/v1/auth/logout` has no body. If a cookie is present, its database session row is marked revoked and a logout audit is written when the user still resolves. The response expires the cookie and returns `{loggedOut:true}`. Logout is effectively safe to repeat.

User deactivation and assisted password reset revoke all target-user sessions. Normal forced password change does not revoke other sessions in the current implementation.

## Password handling

- Hash: `bcryptjs`.
- Cost: 12.
- Creation and change policy: 12–128 characters; no complexity rule for permanent passwords.
- Assisted temporary password: 20 characters, generated with `node:crypto`, includes upper/lower/digit/symbol.
- Login validator accepts 8–128 to avoid rejecting legacy hashes before comparison.

Sources: `src/modules/auth/password-policy.js`, `src/modules/auth/auth.service.js`, `src/modules/auth/password-change.service.js`, `src/modules/auth/assisted-password-reset.service.js`.

## Forced password change

```text
temporary password → login succeeds and sets cookie
→ login JSON has must_change_password=true
→ all requireAuth() routes return 403 PASSWORD_CHANGE_REQUIRED
→ POST /api/v1/auth/change-password using same cookie
→ must_change_password=false
→ GET /api/v1/auth/me and normal protected access succeed
```

`POST /api/v1/auth/change-password` intentionally uses `requireSessionUser()`, not `requireAuth()`. Body is strict JSON:

```json
{"newPassword":"<12-128 CHAR NEW PASSWORD>","confirmPassword":"<SAME VALUE>"}
```

It rejects a password equal to the temporary/current password. Success is `200` with `{changed:true}`. A normal account receives `409 PASSWORD_CHANGE_NOT_REQUIRED`; a race/failure can return `409 PASSWORD_CHANGE_FAILED`.

## Assisted password reset

`POST /api/v1/users/{id}/assisted-password-reset` requires a normal authenticated session, strict JSON `{reason:1..500,confirmed:true,turnstileToken?}`, and Turnstile action `assisted_password_reset` when enabled.

Authority:

- SUPER_ADMIN: any user in the same organization except self.
- PROJECT_ADMIN: targets whose every role is within its full project scope; cannot reset SUPER_ADMIN.
- STATE_COORDINATOR: targets whose every role is within its state/project scope; cannot reset higher roles.
- FACILITATOR: only VSLA_MEMBER-only targets with an active linked membership in a group where the facilitator currently has `DIGITAL_ACCESS_MANAGE`.
- Officer status or ordinary membership alone: no authority.

Success replaces the hash, sets `must_change_password=true`, revokes all target sessions, writes a secret-free audit, and returns the temporary password once in the JSON response. The client must show it once, never persist/log it, and require a deliberate handoff. This flow is not recommended for member-first V1.

## Cloudflare Turnstile

Configuration and behavior:

- `TURNSTILE_ENABLED`: missing/empty/`false` disables; `true` enables; other values cause configuration failure.
- `NEXT_PUBLIC_TURNSTILE_SITE_KEY`: browser-visible site key.
- `TURNSTILE_SECRET_KEY`: server only.
- `TURNSTILE_ALLOWED_HOSTNAMES`: required comma-separated list when enabled.
- Actions: `login`, `assisted_password_reset`.
- Siteverify: URL-encoded server POST, 5-second timeout, max response token length 2048.
- Validates provider `success`, exact action, and allowed hostname.
- `TURNSTILE_TEST_MODE=true` is allowed only outside production and only with one of Cloudflare's known test secrets.
- Provider/network/malformed response: `503 TURNSTILE_UNAVAILABLE`; bad/mismatched token: `400 TURNSTILE_INVALID`; missing token: `400 TURNSTILE_REQUIRED`.

### Native critical question

**HOW WILL A NATIVE EXPO APP OBTAIN A VALID TURNSTILE TOKEN?**

The repository has no answer. Its only client is `turnstile-widget.js`, which loads Cloudflare's browser script and renders into a DOM element/frame. React Native has no DOM. A valid mobile design needs an approved browser/WebView challenge hosted on an allowed HTTPS hostname and a secure result handoff, or a separately designed mobile authentication flow that retains equivalent anti-abuse protection. Hostname/action verification must not be weakened.

**Current mobile login: REQUIRES A MOBILE-SPECIFIC TURNSTILE FLOW / WEBVIEW / AUTH DESIGN CHANGE.**

## Native session feasibility

**CURRENT AUTH MODEL:** host-only HttpOnly cookie + DB-backed opaque session.

**CAN MOBILE USE AS-IS? PARTIALLY.** A native HTTP stack can send cookies, and HttpOnly is desirable, but React Native/Expo cookie capture, durable persistence, cross-restart restoration, and logout deletion must be proven on Android and iOS. The JSON response contains no token fallback. `SameSite=Lax` mainly governs browser contexts; `Secure` requires HTTPS in production.

**RECOMMENDED MOBILE APPROACH:** before app implementation, choose either (a) a tested native cookie jar whose persisted cookie material is protected by platform Keychain/Keystore semantics and never exposed to JS logs, or (b) a backend-designed, revocable mobile session token contract stored with Expo SecureStore/Keychain/Keystore. Option (b) is cleaner operationally but is a backend change and must preserve revocation, expiry, forced password change, audit, and Turnstile.

**BACKEND CHANGE REQUIRED? YES before production**, unless an explicit multi-platform proof demonstrates the existing cookie flow is safe and durable.

Sources: `src/app/api/v1/auth/**`, `src/lib/auth/**`, `src/lib/security/turnstile.js`, `src/components/turnstile-widget.js`, `tests/forced-password-change.test.js`, `tests/turnstile.test.js`, `tests/assisted-password-reset.test.js`.
