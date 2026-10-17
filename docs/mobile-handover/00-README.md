# Visave mobile developer handover

This pack describes the Visave implementation as it exists on branch `docs/mobile-developer-handover` on 17 October 2026. The codebase, route handlers, services, repositories, migrations, and tests are the source of truth. Items that the repository cannot prove are marked **NEEDS CONFIRMATION**.

## Executive summary

Visave is a VSLA (Village Savings and Loan Association) platform for organizations, projects, facilitators (called Agents in parts of the UI), groups, members, cycles, meetings, savings, Social Fund, fines, loans, reconciliation, and share-out. It is a JavaScript Next.js 16 App Router application backed by PostgreSQL through the low-level `pg` driver. There is no ORM. Route handlers call domain services/repositories, and authorization is enforced by both permission codes and contextual group-action policy.

Staging base URL supplied for this handover: `https://testvisave.gidacare.com`. Production: `https://visave.gidacare.com`. Neither URL exists in repository configuration, so ownership, certificates, deployed revision, and readiness are **NEEDS CONFIRMATION** before testing.

**MOBILE APP MUST NOT CONNECT DIRECTLY TO POSTGRESQL.** It must use HTTPS API routes only. It must never contain database, Turnstile-secret, Google, Twilio, encryption, or server-storage credentials.

## Recommendation

Build a **MEMBER-FIRST** React Native + Expo V1. The current self-service APIs already support:

- login, forced password change, session check, and logout;
- My Groups and cycle history;
- personal savings, Social Fund, fines, loan/repayment, and share-out activity;
- meeting history and meeting detail;
- an authorized Google Meet join URL for open Virtual/Hybrid meetings;
- self loan request and cancellation in an eligible open meeting;
- in-app notification list/read state;
- profile/session identity and Google Meet email.

Do not put facilitator/admin/officer financial operations or offline writes in the first production milestone. Although many operator APIs exist, their role/mode/state matrix, reconciliation signature capture, high-risk money mutations, and idempotency/concurrency requirements make a multi-role V1 substantially riskier.

Recommended stack: Expo-managed React Native with TypeScript, Expo Router, TanStack Query (or equivalent server-state layer), a single API client, and platform secure storage for any finalized mobile credential/session artifact. This is a mobile recommendation, not an existing repository dependency.

## Authentication readiness

The web app uses an opaque, database-backed, eight-hour session in an `HttpOnly`, `SameSite=Lax`, `Secure`-in-production cookie named `vsla_session`. The API does not return the token in JSON and does not accept a Bearer token. React Native can only use this as-is if its HTTP stack reliably captures, persists, restores, and sends the cookie; that behavior has not been proven in this repository.

Cloudflare Turnstile is required by login and assisted reset when `TURNSTILE_ENABLED=true`. The existing widget is a browser-only script/frame component. A native Expo token-acquisition flow is not implemented or tested.

Therefore native authentication is **PARTIAL** and overall readiness is **READY AFTER SPECIFIED BLOCKERS**.

## Top five mobile gaps

1. Decide and prove native Turnstile token acquisition; likely an approved WebView/browser flow or a mobile-specific authentication design is required.
2. Decide and prove session-cookie persistence across app restarts, or add a purpose-built mobile token/session contract.
3. Verify production-grade distributed abuse protection and trusted-proxy client-IP handling; current application rate limits are process-local.
4. Verify durable, backed-up, multi-instance-safe private file storage; the code's default fallback is operating-system temporary storage.
5. Treat push notifications and a one-call JSON dashboard as optional backend enhancements; neither currently exists, while member screens can poll/compose current APIs.

## First development milestone

Resolve the Turnstile and session decisions, then build a staging-only vertical slice: Login → forced password change → `GET /api/v1/auth/me` restoration → My Groups → My Activity → Meeting History/Detail → Logout. Do not begin a production login implementation until both blockers have a written, tested outcome.

## Pack contents

| File | Purpose |
|---|---|
| `01-system-architecture.md` | Runtime, layers, storage, integrations, and networking |
| `02-mobile-scope-recommendation.md` | Ready-now versus backend-change scope |
| `03-authentication-and-sessions.md` | Exact login/session/Turnstile/password flows |
| `04-api-catalog.md` | All 130 implemented API method/route pairs and contracts |
| `05-role-permission-matrix.md` | System roles, officer assignments, PA/MM authority |
| `06-business-workflows.md` | Meetings, loans, finance, share-out, self-service |
| `07-domain-data-model.md` | Mobile-oriented entity and lifecycle guide |
| `08-mobile-screen-map.md` | Recommended navigation and screen-to-API mapping |
| `09-errors-and-status-codes.md` | HTTP and domain error handling |
| `10-integrations.md` | Turnstile, Google Meet, Twilio, notifications |
| `11-files-and-media.md` | Constitution, signatures, PDF/Excel contracts |
| `12-environment-and-configuration.md` | Safe/public versus server-only configuration |
| `13-staging-and-testing.md` | Fixtures, staging accounts, and test procedure |
| `14-security-guidelines.md` | Mobile security requirements |
| `15-mobile-backend-gaps.md` | Prioritized blockers and enhancements |
| `16-open-decisions.md` | Product/architecture decisions with defaults |
| `17-mobile-developer-start-checklist.md` | Ordered implementation checklist |
| `visave-mobile.postman_collection.json` | Sanitized request examples; Turnstile caveat applies |

## Non-negotiable warnings

- The server is authoritative for authorization, balances, eligibility, service charges, reconciliation, and share-out.
- Never authorize from cached roles or visible UI alone.
- Never accept or substitute an arbitrary `memberId` for self-service views; use `/api/v1/me/**`.
- Never log passwords, temporary passwords, session cookies, Turnstile tokens, or financial/member PII.
- Do not store sensitive credentials in AsyncStorage.
- Do not bypass Turnstile or `must_change_password`.

Primary sources: `package.json`, `src/app/api/**/route.js`, `src/lib/auth/session.js`, `src/modules/group-access/group-access.service.js`, `src/modules/member-self/member-self.service.js`, `database/bootstrap/001_rbac.sql`.
