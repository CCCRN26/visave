# Mobile V1 scope recommendation

## Recommendation: MEMBER-FIRST

The member self-service surface is coherent, server-derived, read-heavy, and already exposed as JSON. Multi-role operations exist but are much more sensitive to operating mode, current-cycle officer identity, meeting state, reconciliation, idempotency, and segregation of duties. A member-first release can deliver useful value while native auth is stabilized.

## Capability assessment

| Capability | Classification | Evidence / caveat |
|---|---|---|
| Login | BACKEND CHANGE REQUIRED before production | JSON route exists, but native Turnstile and cookie persistence are unresolved |
| Logout | MOBILE_READY_WITH_CAVEAT | Works if native sends the session cookie; clears/revokes it |
| Forced password change | MOBILE_READY_WITH_CAVEAT | Exact API exists; depends on working cookie session |
| Session restoration/profile | MOBILE_READY_WITH_CAVEAT | `GET /api/v1/auth/me`; `PASSWORD_CHANGE_REQUIRED` must route correctly |
| Member dashboard | MOBILE_READY_WITH_CAVEAT | Compose My Groups + activity; no single member dashboard API |
| Staff/officer dashboard | BACKEND_CHANGE_REQUIRED | Web server-component service only; no JSON dashboard route |
| My Groups | MOBILE_READY_WITH_CAVEAT | Cookie auth; server-derived linked identity |
| Group activity/detail | MOBILE_READY_WITH_CAVEAT | Personal activity endpoint; generic group detail is role/action scoped |
| Meeting history/detail | MOBILE_READY_WITH_CAVEAT | Member-specific read-only endpoints exist |
| Join Google Meet | MOBILE_READY_WITH_CAVEAT | Open external URL only when server returns non-null `joinUrl` |
| Savings history | MOBILE_READY_WITH_CAVEAT | Present in personal activity, capped combined feed at 50 |
| Social Fund history | MOBILE_READY_WITH_CAVEAT | Present in personal activity |
| Fine history | MOBILE_READY_WITH_CAVEAT | Present in personal activity |
| Loan/repayment history | MOBILE_READY_WITH_CAVEAT | Current outstanding loan summary + combined activity; not a fully paged archive |
| Loan self-request | MOBILE_READY_WITH_CAVEAT | Only ordinary member, active group/cycle, open meeting, PRESENT attendance, eligibility checks |
| Share-out history | MOBILE_READY_WITH_CAVEAT | Current/selected cycle summary + activity; no dedicated paged member archive |
| Notifications | MOBILE_READY_WITH_CAVEAT | In-app list/read; no push and list capped at 100 |
| Assisted password reset | NOT RECOMMENDED FOR V1 | High-risk manager action, Turnstile, one-time temporary password handling |
| Facilitator operations | NOT RECOMMENDED FOR V1 | APIs mature but broad operational surface and PA/MM restrictions |
| Chairperson/Record Keeper operations | NOT RECOMMENDED FOR V1 | Requires verified digital officer identity and extensive financial UX |
| Meeting operations | NOT RECOMMENDED FOR V1 | Open/attendance/post/reconcile/sign/close is high risk |
| Financial posting/reversal | NOT RECOMMENDED FOR V1 | Server authoritative; idempotency, concurrency and irreversible UX risk |
| Offline read cache | READY NOW with policy | Cache nonsecret reads; revalidate on focus/online |
| Offline mutation | BACKEND CHANGE REQUIRED | No sync protocol; many writes have no idempotency key and state changes quickly |
| Push notifications | BACKEND CHANGE REQUIRED | No device/token/provider infrastructure |
| PDF/XLSX downloads | MOBILE_READY_WITH_CAVEAT | Binary endpoints work with cookie; app must store/share securely |

## V1 navigation

Suggested tabs: **Home**, **Groups**, **Meetings**, **Notifications**, **Profile**. Home is a client composition of My Groups and selected-group activity, not a claim that a dashboard endpoint exists.

The first release should be primarily read-only, plus ordinary-member loan request/cancel after authentication is proven. Keep notifications read-state changes and profile Google Meet email as low-risk mutations. Defer all operator money and lifecycle mutations.

## Explicitly not a web clone

Do not reproduce organization/project/user/facilitator administration, onboarding, constitution authoring, officer assignment, financial posting, reconciliation, cycle closeout, reporting exports, or Google OAuth administration merely because the web application has them. These are possible later roles, not V1 requirements.

## Offline policy

| Category | Policy |
|---|---|
| My Groups, meeting history, previously loaded activity | SAFE TO CACHE READ-ONLY, encrypt if device threat model requires |
| Current balances, eligibility, notifications | POSSIBLE WITH REVALIDATION; show “last updated” and do not imply current authority |
| Loan request/cancel | DO NOT WRITE OFFLINE in V1 |
| Attendance, savings, Social Fund, fines, loans, repayments, reconciliation, share-out | DO NOT WRITE OFFLINE |
| Any future queued transaction sync | REQUIRES DEDICATED SYNC DESIGN with idempotency, ordering, conflict policy, and audit |

Sources: `src/app/api/v1/me/**`, `src/modules/member-self/member-self.service.js`, `src/modules/member-meetings/member-meeting.service.js`, `src/modules/group-access/group-access.service.js`.
