# Environment and configuration

## Environments

| Environment | Base URL | Status |
|---|---|---|
| Staging | `https://testvisave.gidacare.com` | Supplied for this handover; **NEEDS CONFIRMATION** because no authoritative repository configuration declares it. |
| Production | `https://visave.gidacare.com` | Supplied for this handover; **NEEDS CONFIRMATION** because no authoritative repository configuration declares it. |

Recommended mobile development value:

```dotenv
EXPO_PUBLIC_API_BASE_URL=https://testvisave.gidacare.com
```

Any `EXPO_PUBLIC_*` value is bundled into the app and must be treated as public. Keep separate build profiles for development/staging/production. Never silently fall back from an invalid production URL to staging or localhost.

## Classification

### Safe in mobile

| Concept/value | Notes |
|---|---|
| API base URL | Public HTTPS origin only; environment-specific. |
| Turnstile site key | Public by design, but include only after the native challenge design is approved. The current name is `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on web; the mobile project may map an approved value to its own public build variable. |
| Non-sensitive feature flags | Mobile-owned flags only; they are UX hints, never authorization. |
| App identifiers/deep-link scheme | Public platform metadata, after the product decision is made. |

### Server only

The names below are documented so the mobile developer can recognize and reject them. Do not copy their values, expose them through an API, place them in Expo configuration, or request them from the backend owner.

| Variable/concept | Why server only |
|---|---|
| `DATABASE_URL` | PostgreSQL credentials/network location. |
| `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD` | Bootstrap credentials; never an app configuration mechanism. |
| `TURNSTILE_SECRET_KEY` | Cloudflare Siteverify credential. |
| `TURNSTILE_ALLOWED_HOSTNAMES`, `TURNSTILE_TEST_MODE`, `TURNSTILE_ENABLED` | Server verification/security policy. Mobile may be told only the effective behavior for an environment. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI`, `GOOGLE_MEET_ACCESS_TYPE` | Current Google integration is an organization/server OAuth flow. Even where an OAuth client ID is not intrinsically secret, the current server configuration is not a mobile contract. |
| `GOOGLE_TOKEN_ENCRYPTION_KEY` | Protects stored OAuth tokens. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` | Provider credentials. |
| `TWILIO_FROM_NUMBER`, `TWILIO_TRIAL_RECIPIENT`, `TWILIO_TRIAL_RECIPIENTS`, `TWILIO_TRIAL_TEMPLATE`, `TWILIO_SMS_ENABLED`, `TWILIO_TRIAL_MODE` | Server-side delivery and approval policy. Recipient values may be PII. |
| `VSLA_PRIVATE_UPLOAD_ROOT` | Internal storage topology. |
| Any session token/cookie value | Per-session credential, not build configuration. |

### Not needed in mobile

`NODE_ENV`, database migration/acceptance database names, reset flags, seed values, server listen settings, private-storage roots, Twilio delivery settings, Google OAuth server settings, and all report/storage implementation configuration are not mobile inputs.

## Native networking readiness: PARTIAL

React Native networking is not subject to browser CORS enforcement in the same way as browser JavaScript. No explicit application CORS middleware/headers, `OPTIONS` handlers, Origin/Referer allow-list, or CSRF-token mechanism was found in the route code. That does **not** prove the deployed proxy permits every client; perform a real-device staging smoke test.

The important constraints are:

- Authentication is a host-only `vsla_session` HttpOnly cookie. The backend does not read `Authorization: Bearer`.
- The cookie is `Secure` in production, `SameSite=Lax`, path `/`, and expires with the eight-hour DB session.
- A native client must prove that it captures `Set-Cookie`, sends the cookie on later API and binary requests, persists it across app restarts if required, honors expiry/deletion, and does not expose it to application logs or ordinary storage.
- HttpOnly is valuable in a browser, but React Native cookie-library behavior varies. Do not assume `fetch`/Axios persistence from a simulator test.
- Google connect/callback endpoints are redirect workflows and should not be called as ordinary JSON APIs.
- Relative URLs returned or used by the web UI must not be confused with the configured absolute API base URL.
- TLS is mandatory. Android/iOS cleartext exceptions are not an acceptable production solution.

**Conclusion:** ordinary JSON routes are network-callable, but native login/session transport is not production-ready until the Turnstile and cookie-persistence proof is complete or a dedicated mobile token contract is added.

## Rate limiting

| Endpoint class | Current behavior |
|---|---|
| Login | 10 attempts per 15-minute window per resolved IP. |
| Public group join | 5 requests per 15-minute window per resolved IP. |
| Public contact | 5 requests per 15-minute window per resolved IP. |
| Assisted password reset | Turnstile-protected; no separate distributed limiter was found. |
| Authenticated business mutations | Authorization, validation, state checks, and selected idempotency controls; no general mobile rate limiter was found. |

The limiter uses process-memory maps. It is not shared across instances, database-backed, or a substitute for edge/provider controls. Its key depends on forwarded/client IP headers, so trusted-proxy configuration matters. The current responses do not establish a `Retry-After` contract.

Mobile behavior on 429: stop automatic retries, show a calm retry-later message, and require a deliberate later attempt. Never rotate identities, spoof forwarded headers, or retry against another host. Backend owners should confirm distributed protection and proxy IP trust before production scale; see `15-mobile-backend-gaps.md`.

Source: `src/lib/auth/rate-limit.js`, authentication/public route handlers, `src/lib/auth/session.js`, `next.config.mjs`.

## Client configuration rules

1. Check the selected base URL against a compile-time allow-list for each release channel.
2. Use one API client with JSON/error decoding, cookie or future token transport, request IDs if introduced, and redacted logging.
3. Do not add `/api/v1` to endpoints that already include it; represent paths exactly as catalogued.
4. Never ship a development Turnstile dummy key/secret combination in production.
5. Treat remote roles, permissions, operation mode, and officer assignment as mutable server state. Refresh them rather than promoting cached values to authority.
6. Pinning certificates is a product/security decision, not currently required by the backend contract. If adopted, design rotation and recovery first.

