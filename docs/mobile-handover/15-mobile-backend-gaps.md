# Mobile backend gaps

This register separates release gates from ordinary scope improvements. **There are 4 BLOCKER items in this handover:** two before native login and two before production. There is no blocker to scaffolding the app, building unauthenticated UI, or using mocked contracts.

## Blockers

### B1 — BLOCKER BEFORE MOBILE LOGIN: native Turnstile token acquisition

**Evidence:** Login and assisted reset require a valid Cloudflare token when enabled. The existing client component uses a browser script/DOM widget; no native challenge/token hand-off exists.

**Required outcome:** Approve and test a mobile-specific flow (for example, constrained WebView/browser challenge on an allowed hostname) or an alternative backend/mobile authentication design that preserves server verification, action matching, and hostname policy. Never bypass Turnstile.

**Owners:** backend/security + mobile.  
**Sources:** `src/lib/security/turnstile.js`, `src/components/turnstile-widget.js`.

### B2 — BLOCKER BEFORE MOBILE LOGIN: session transport and persistence contract

**Evidence:** The server authenticates only the `vsla_session` HttpOnly cookie. No bearer-token API exists. Browser cookie behavior is assumed; native capture, persistent cookie-jar behavior, restart restoration, logout deletion, and authenticated binary downloads are unproven.

**Required outcome:** Either certify a reviewed native cookie implementation end-to-end on supported devices, or add and document a security-reviewed mobile access/refresh-token contract with server rotation/revocation. Do not expose the existing token in JavaScript merely to make it easier.

**Owners:** backend/security + mobile.  
**Sources:** `src/lib/auth/session.js`, `src/modules/auth/auth.service.js`, `src/app/api/v1/auth/**`.

### B3 — BLOCKER BEFORE MOBILE PRODUCTION: distributed abuse protection and client-IP trust

**Evidence:** Login/public endpoint limiting is process-memory only and keyed from request IP information. It is not shared across replicas and no general authenticated mobile abuse-control contract is present.

**Required outcome:** Backend/operations must document and verify trusted-proxy IP resolution plus production edge/distributed protection for login, reset, and other sensitive workflows. Preserve user-safe 429 behavior and define retry metadata if mobile needs it.

**Owners:** backend/security/operations.  
**Sources:** `src/lib/auth/rate-limit.js`, login and public route handlers.

### B4 — BLOCKER BEFORE MOBILE PRODUCTION: durable private-file storage proof

**Evidence:** Private files use a server filesystem root and fall back to OS temporary storage. The repository does not prove shared, durable, backed-up production storage across instances.

**Required outcome:** Operations/backend must confirm a durable single-instance deployment contract or migrate/configure supported shared object/storage semantics and retention/backup procedures. Validate authenticated downloads and atomic replacement/finalization after deployment.

**Owners:** backend/operations.  
**Sources:** `src/lib/private-storage.js`, constitution/signature services.

## Important but non-blocking

| Gap | Evidence and mobile impact | Recommended action |
|---|---|---|
| No JSON dashboard endpoint | Web dashboard reads server services directly. | Compose the member home screen from `/me/groups`, activity, meetings, and notifications; consider an aggregate API only after measuring calls. |
| No native push | DB in-app notifications and server-side SMS exist; device tokens/providers do not. | Poll/revalidate in V1. Add registration, preferences, Expo/FCM/APNs delivery, rotation and cleanup only if product requires push. |
| No general API CORS/Origin/CSRF layer | Native calls are not browser-CORS-bound, but proxy behavior is unproven; cookie mutations rely on session cookie/SameSite rather than CSRF tokens. | Real-device staging test. If any browser/WebView client is added, conduct a separate CSRF/origin review. |
| Response/status consistency has exceptions | Most routes use envelopes; health and binary/redirect routes do not. Authorization errors may keep code `FORBIDDEN` while their message names a more specific reason. | Central client decoder keyed first by HTTP/content type and documented `error.code`; do not parse messages as stable codes. |
| Operational lists lack pagination | Notifications cap at latest 100; several group-operation lists return unpaginated arrays. | Accept member V1 limits; add cursor/page contracts before large operator workflows. |
| No JSON report API | Reports are PDF/XLSX only. | Use self-service JSON for native views and optional PDF sharing; do not reimplement calculations. |
| Assisted reset is awkward on mobile | Privileged flow requires Turnstile and exposes a one-time temporary password in a successful response. | Exclude from member-first V1; design secure display/handoff if an operator phase includes it. |
| Google OAuth is web-oriented | Connect/callback use browser redirects and OAuth-state cookies. | Keep organization connection in the web admin; mobile members only consume authorized join URLs. |
| No SMS delivery status API | Twilio is trial-restricted and server-side. | Do not show carrier-delivered status; add a backend status contract only if product needs it. |
| No client correlation-ID contract | Error envelopes do not establish a request/support identifier. | Add privacy-safe server correlation IDs before broad production support if observability requires them. |
| URLs not repository-authoritative | Staging/production origins were supplied externally. | Backend/operations must confirm endpoints and certificates before build/release. |
| Role seed terminology includes legacy codes | Some bootstrap history includes `MEMBER`/`GROUP_OFFICER`, while current authorization uses `VSLA_MEMBER` plus dynamic officer assignments. | Mobile must consume current session roles and officer assignment DTOs; backend owners should reconcile legacy seed/data assumptions. |

## Future enhancements

| Enhancement | Why it is not a current blocker |
|---|---|
| Dedicated mobile auth endpoints/token family | Required only if certified cookie transport is rejected; design follows B2 decision. |
| Native push | In-app polling supports a functional V1. |
| Read-optimized member dashboard aggregate | Existing self-service APIs can compose V1. |
| Deep/universal links | External Meet launch is enough for V1 unless product requires inbound routes. |
| Biometric local unlock | Convenience layer after session design, not authentication. |
| Operator-focused mobile APIs/DTOs | Existing endpoints are broad but the first release should remain member-first. |
| Offline transaction synchronization | Requires conflict/version protocol, server idempotency coverage, replay rules, device queue encryption, and workflow locks; not safe today. |
| Fine-grained notification pagination/preferences | Latest-100 in-app list is adequate for initial scope. |

## Capabilities that are already adequate

- Forced password change has a clear API and server gate; its blocker is session/login transport, not the change-password contract.
- Logout revokes the current DB session and expires the cookie; prove native cookie cleanup under B2.
- Member identity is server-derived in `/api/v1/me/**` and ordinary self-loan requests.
- Selected financial mutations already require idempotency keys and use server transactions; that does not make arbitrary offline replay safe.
- Google Meet member join URLs are exposed through authorized meeting detail; mobile only needs safe external launch.

## Overall readiness

**READY AFTER SPECIFIED BLOCKERS.** Development can begin with contract types, navigation, mocked member screens, and non-authenticated infrastructure. Do not claim an integrated native login milestone until B1 and B2 are closed. Do not release to production until B3 and B4 are closed or explicitly accepted with documented compensating controls by the responsible owners.

