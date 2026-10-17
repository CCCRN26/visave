# API catalog

This catalog covers all **130 implemented method/route pairs** under `src/app/api` as of 17 October 2026. The exact route files are the final source of truth. Paths use `{name}` for Next.js `[name]` segments.

## Shared contract

- Base: `<API_BASE_URL>`; staging value supplied externally is `https://testvisave.gidacare.com` (**NEEDS CONFIRMATION** against the deployed revision).
- Default request content type: `application/json`. The constitution upload is `multipart/form-data`. Downloads are binary.
- Protected routes authenticate using the `vsla_session` cookie. There is no Bearer-token support.
- JSON success: `{ "success": true, "data": <value> }`.
- JSON failure: `{ "success": false, "error": { "code": string, "message": string, "details"?: object } }`.
- Normal status: `200`; creation/posting endpoints marked `201`; binary downloads `200`; health may return `503`.
- Common failures: `400 VALIDATION_ERROR`, `401 AUTHENTICATION_REQUIRED`, `403 FORBIDDEN`/`PASSWORD_CHANGE_REQUIRED`, `404 NOT_FOUND`, `409 CONFLICT`, `429 RATE_LIMITED`, `500 INTERNAL_ERROR`. Domain-specific errors are in `09-errors-and-status-codes.md`.
- Zod rejects invalid fields. Schemas explicitly marked strict also reject unknown keys; other object schemas may strip unknown keys.
- Money inputs are decimal **strings**, never currency-formatted numbers. Money outputs from PostgreSQL are usually decimal strings.
- `MOBILE_READY_WITH_CAVEAT` (MR-C) means the HTTP contract is usable but native cookie/Turnstile handling or product UX still needs resolution.

Readiness abbreviations: **MR** mobile-ready; **MR-C** mobile-ready with caveat; **WO** web-only currently; **BCR** backend change required; **NFM** not for mobile V1.

## Schema registry

| Name | Exact request/query fields and validation |
|---|---|
| `list` | query `page` int ≥1 default 1; `pageSize` 1–100 default 20; `search` ≤100 default empty; optional `status`, UUID `projectId/stateId/lgaId/facilitatorId` |
| `login` | `email` valid/lowercased; `password` 8–128; optional `turnstileToken` (server requires it when enabled) |
| `forcedPasswordChange` | strict `newPassword` 12–128, `confirmPassword` equal |
| `assistedReset` | strict `reason` 1–500, `confirmed:true`, optional `turnstileToken` |
| `project` | `code` 2–40 uppercased, `name` 2–180, optional nullable `description` ≤2000, dates, status `DRAFT/ACTIVE/COMPLETED/SUSPENDED/ARCHIVED` |
| `group` | `name` 2–180; UUID `projectId/stateId/lgaId`; optional nullable UUID `communityId/facilitatorUserId`; optional `communityName` ≤300, ISO date, `meetingLocation` ≤500, `expectedMemberCount` 15–30, `notes` ≤2000; `groupType SUPERVISED/SELF_MANAGED`; group status enum |
| `userCreate` | first/last 1–100, email, optional phone, password 12–128, user status, `roleCode` current system role, optional project/state UUID |
| `userUpdate` | strict nonempty subset of first/last, nullable phone, status |
| `member` | names, sex enum, nonfuture DOB, nullable phone, nonfuture `dateJoined`, optional linked user/status, `joinCurrentCycle`, optional cycle/start date |
| `constitution` | positive decimal `shareValue`; shares 1–5 and min≤max; nonnegative decimal Social Fund; loan multiple >0≤3; service charge ≥0; term 1–3; frequency; optional freeze/quorum/notes; fine-rule array |
| `cycleCreate` | UUID constitution, positive cycle number, start/end dates (end after start and within 12 months), optional share-out date within range/day 1–7, status `DRAFT/READY` |
| `cycleUpdate` | optional end/share-out/day/status `DRAFT/READY` |
| `officer` | UUID cycle/member, one of five positions, optional appointment date |
| `openMeeting` | strict date; mode `PHYSICAL/VIRTUAL/HYBRID`; setup `MANUAL/AUTOMATIC`; manual nonphysical requires valid `https://meet.google.com/...` |
| `attendance` | `updates[]` min 1: UUID member, `PRESENT/LATE/ABSENT/EXCUSED`, optional notes ≤1000 |
| `savings` | strict UUID `memberId`, positive integer `numberOfShares`, idempotency key 8–160 |
| `social` | strict UUID `memberId`, idempotency key 8–160 |
| `fine` | social fields + UUID `fineRuleId`, optional nullable reason ≤1000 |
| `reversal` | strict idempotency key 8–160 |
| `reconciliation` | strict nonnegative decimal strings `countedSavingsLoanBalance/countedSocialFundBalance`; optional notes ≤2000; PNG data URL ≤1,500,000 chars (decoded 200 B–1 MiB) |
| `loanRequest` | strict optional UUID `memberId`; positive decimal principal; positive integer term; purpose 3–2000. Self requests omit `memberId` |
| `loanApprove` | strict positive decimal principal, positive integer term, optional nullable notes ≤2000 |
| `loanReject/cancel/default` | strict notes or reason 3–2000 |
| `loanDisburse/reversal` | strict idempotency key 8–160 |
| `repayment` | strict positive decimal `paymentAmount`, idempotency key 8–160 |
| `shareoutApprove` | strict idempotency key 8–160 |
| `payout` | strict UUID `entitlementId`, idempotency key 8–160 |
| `carryForward` | strict UUID `targetCycleId`, idempotency key 8–160 |

## Authentication

| Method and route | Purpose and contract | Auth / authorization | Success and notable errors | Ready |
|---|---|---|---|---|
| `POST /api/v1/auth/login` | JSON `login`; creates 8-hour session cookie | No prior auth; Turnstile action `login`; IP memory rate limit | `200 {user}`; 400 Turnstile/validation, 401 invalid credentials, 429 | BCR |
| `GET /api/v1/auth/me` | Restore current identity, roles, permissions | `requireAuth` | `200 {user}`; 401; 403 password change | MR-C |
| `POST /api/v1/auth/change-password` | JSON `forcedPasswordChange` | `requireSessionUser`; only forced-change account | `200 {changed:true}`; 400, 401, 409 | MR-C |
| `POST /api/v1/auth/logout` | No body; revoke current session and expire cookie | Session optional in practice | `200 {loggedOut:true}` | MR-C |

Representative login success:

```json
{"success":true,"data":{"user":{"id":"user-id-example","organization_id":"organization-id-example","first_name":"Example","last_name":"Member","email":"member@example.invalid","phone":null,"status":"ACTIVE","must_change_password":false}}}
```

Sources: `src/app/api/v1/auth/**`, `src/modules/auth/**`, `src/lib/auth/**`.

## Users and Digital Access

| Method and route | Purpose and contract | Auth / authorization | Success / caveats | Ready |
|---|---|---|---|---|
| `GET /api/v1/users` | query `list`; paged scoped users | `user.view`; management scope | `200 {items,total,page,pageSize}` | NFM |
| `POST /api/v1/users` | JSON `userCreate`; new account is forced-change | `user.create` + role ceiling/project/state scope | `201` safe user row | NFM |
| `GET /api/v1/users/{id}` | User detail | `user.view` + management scope | `200` safe user fields | NFM |
| `PATCH /api/v1/users/{id}` | JSON `userUpdate`; deactivation revokes sessions | `user.update` + management scope | `200` safe user fields | NFM |
| `POST /api/v1/users/{id}/assisted-password-reset` | JSON `assistedReset`; returns temporary password once | dedicated scope policy + Turnstile | `200 {target,temporaryPassword}`; no-store | NFM |
| `POST /api/v1/groups/{id}/members/{memberId}/digital-access` | JSON `CREATE_USER` (names/email/phone/password) or `LINK_EXISTING` (userId) | group `DIGITAL_ACCESS_MANAGE` + `member_access.manage` unless digital officer path | `201 {memberId,user,created}` | NFM |
| `DELETE /api/v1/groups/{id}/members/{memberId}/digital-access` | Unlink member login | same as above | `200 {memberId,disabled:true}` | NFM |

`CREATE_USER` sets `must_change_password=true`; `LINK_EXISTING` does not alter password state. Sources: `src/modules/users/user-access.service.js`, `src/modules/member-managed/member-managed.service.js`.

## Projects

| Method and route | Purpose / contract | Auth / authorization | Success | Ready |
|---|---|---|---|---|
| `GET /api/v1/projects` | query `list` | `project.view`, organization scope | `200 {items,total,page,pageSize}` | NFM |
| `POST /api/v1/projects` | JSON `project` | `project.create` | `201` project row | NFM |
| `GET /api/v1/projects/{id}` | Project detail | `project.view` + project scope | `200` project row | NFM |
| `PATCH /api/v1/projects/{id}` | partial JSON `project` | `project.update` + project scope | `200` project row | NFM |

## Facilitators

| Method and route | Purpose / contract | Auth / authorization | Success / errors | Ready |
|---|---|---|---|---|
| `GET /api/v1/facilitators` | pagination/search/status/project/state/LGA query | `facilitator.view` + scoped repository | paged result | NFM |
| `POST /api/v1/facilitators` | strict names/email/phone/staffCode/password/project/state/LGA/groupIds | `facilitator.create` + scope | `201` facilitator DTO | NFM |
| `GET /api/v1/facilitators/{id}` | Profile + assigned groups | `facilitator.view` + service scope | facilitator DTO | NFM |
| `PATCH /api/v1/facilitators/{id}` | strict partial profile/scope | `facilitator.update` + service scope | facilitator DTO | NFM |
| `GET /api/v1/facilitators/{id}/groups` | Assigned groups | `facilitator.view` + service scope | array | NFM |
| `POST /api/v1/facilitators/{id}/groups/assign` | strict `groupIds[]` max 100, optional reason 5–1000 | `facilitator.assign_groups` + scope | assignment result | NFM |
| `POST /api/v1/facilitators/{id}/activate` | strict `{}` | `facilitator.activate` + scope | active facilitator | NFM |
| `POST /api/v1/facilitators/{id}/deactivate` | optional nullable replacement UUID | `facilitator.deactivate` + scope | inactive facilitator; active groups require replacement | NFM |

## Groups and operating model

| Method and route | Purpose / contract | Auth / authorization | Success / errors | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups` | query `list` | `group.view`; scoped repository | paged groups | NFM |
| `POST /api/v1/groups` | JSON `group` | `group.create`; service validates location/project/facilitator scope | `201` group | NFM |
| `GET /api/v1/groups/{id}` | Group detail | `GROUP_VIEW` / `group.view` | group row | MR-C for officer workspace; member app should prefer `/me` |
| `PATCH /api/v1/groups/{id}` | partial JSON `group` | `GROUP_MANAGE` / `group.update`, plus new project/state scope | group row | NFM |
| `POST /api/v1/groups/{id}/activate` | No parsed body | `CYCLE_MANAGE` / `group.activate` | activated group/cycle | NFM |
| `POST /api/v1/groups/{id}/archive` | strict reason 5–2000 and `confirmation:"ARCHIVE"` | `GROUP_ARCHIVE` / `group.archive` | archived group; blocked by open meeting/transition | NFM |
| `GET /api/v1/groups/{id}/onboarding-status` | Read activation blockers/warnings | `GROUP_VIEW` / `group.view` | status object | NFM |
| `GET /api/v1/groups/{id}/member-managed-readiness` | Read handover proof | `OPERATION_MODE_VIEW` / permission | `{ready,blockingIssues,warnings,proof}` | NFM |
| `POST /api/v1/groups/{id}/operation-mode` | `operationMode`; fallback to PA requires reason 8–1000 | program-scope `OPERATION_MODE_MANAGE` | `{id,operation_mode}` | NFM |
| `PATCH /api/v1/groups/{id}/public-settings` | visibility + intake-status enums | `GROUP_MANAGE` / `group_public.manage`; service facilitator/admin scope | group public settings | NFM |

## Members and cycle participation

| Method and route | Purpose / contract | Auth / authorization | Success | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups/{id}/members` | query `list` | `MEMBER_VIEW` / `member.view` | paged members | NFM |
| `POST /api/v1/groups/{id}/members` | JSON `member`; optionally join current cycle | `MEMBER_MANAGE` or `CYCLE_PARTICIPATION_MANAGE` | `201` member | NFM |
| `GET /api/v1/groups/{id}/members/{memberId}` | Member detail | `MEMBER_VIEW` | member DTO | NFM |
| `PATCH /api/v1/groups/{id}/members/{memberId}` | partial `member` | `MEMBER_MANAGE` | member DTO; obligations may block status change | NFM |
| `DELETE /api/v1/groups/{id}/members/{memberId}` | Soft-remove (`status=REMOVED`) | `MEMBER_MANAGE` | member DTO | NFM |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/participants` | Cycle snapshot | `MEMBER_VIEW` | participant array | NFM |
| `POST /api/v1/groups/{id}/cycles/{cycleId}/participants` | UUID member + participation start date | `CYCLE_PARTICIPATION_MANAGE` | `201` cycle membership | NFM |
| `DELETE /api/v1/groups/{id}/cycles/{cycleId}/participants/{memberId}` | Remove from READY cycle | `CYCLE_PARTICIPATION_MANAGE` | removal result | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/participants` | UUID `memberId`; add eligible participant to open meeting snapshot | `CYCLE_PARTICIPATION_MANAGE` | `201` attendance snapshot row | NFM |

## Constitutions and officers

| Method and route | Purpose / contract | Auth / authorization | Success | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups/{id}/constitution` | List versions | `CONSTITUTION_VIEW` | array | NFM |
| `POST /api/v1/groups/{id}/constitution` | JSON `constitution` | `CONSTITUTION_MANAGE` | `201` constitution | NFM |
| `GET /api/v1/groups/{id}/constitution/{constitutionId}` | Version detail | `CONSTITUTION_VIEW` | constitution | NFM |
| `PATCH /api/v1/groups/{id}/constitution/{constitutionId}` | partial constitution | `CONSTITUTION_MANAGE` | constitution | NFM |
| `POST /api/v1/groups/{id}/constitution/{constitutionId}/approve` | No parsed body | `CONSTITUTION_MANAGE` / `constitution.approve` | approved version | NFM |
| `POST /api/v1/groups/{id}/constitution/{constitutionId}/document` | multipart `file`, optional/replacement `reason` | `CONSTITUTION_MANAGE` | `201` document metadata | NFM |
| `GET /api/v1/groups/{id}/constitution/{constitutionId}/document` | PDF download | `CONSTITUTION_VIEW` | binary PDF, private/no-store | MR-C |
| `GET /api/v1/groups/{id}/officers` | Current/all assignments | `OFFICER_VIEW` | array | NFM |
| `POST /api/v1/groups/{id}/officers` | JSON `officer` | `CYCLE_PARTICIPATION_MANAGE` / `officer.manage` | `201` assignment | NFM |
| `DELETE /api/v1/groups/{id}/officers/{assignmentId}` | End/remove assignment | same | assignment result | NFM |

## Cycles

| Method and route | Purpose / contract | Auth / authorization | Success / errors | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups/{id}/cycles` | List cycles | `CYCLE_VIEW` | array | NFM |
| `POST /api/v1/groups/{id}/cycles` | JSON `cycleCreate` | `CYCLE_MANAGE` | `201`; invalid dates may use `INVALID_CYCLE_DATES` | NFM |
| `GET /api/v1/groups/{id}/cycles/{cycleId}` | Cycle row | `CYCLE_VIEW` | cycle | NFM |
| `PATCH /api/v1/groups/{id}/cycles/{cycleId}` | JSON `cycleUpdate` | `CYCLE_MANAGE` | cycle | NFM |
| `POST /api/v1/groups/{id}/cycles/{cycleId}/activate` | strict `{}` | `CYCLE_MANAGE` / `group.activate` | cycle; prior cycle/share-out/participants/officers rules | NFM |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/closure/readiness` | Closure proof | `SHAREOUT_VIEW` | `{ready,blockingIssues,proof}` | NFM |
| `POST /api/v1/groups/{id}/cycles/{cycleId}/close` | strict `{}` | `CYCLE_CLOSE` / `cycle.close` | closed cycle | NFM |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/final-reconciliation` | Refresh eligibility/history/balances | `RECONCILIATION_VIEW` | state object | NFM |
| `POST /api/v1/groups/{id}/cycles/{cycleId}/final-reconciliation` | JSON `reconciliation` | `RECONCILIATION_OPERATE` | `201` reconciliation | NFM |

## Meetings and attendance

| Method and route | Purpose / contract | Auth / authorization | Success / errors | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups/{id}/meetings` | Operational meeting list | `MEETING_VIEW` | meeting rows | NFM |
| `POST /api/v1/groups/{id}/meetings` | JSON `openMeeting`; may auto-create Meet | `MEETING_OPERATE` / `meeting.create` | `201` meeting, possible nonfatal `googleMeetWarning` | NFM |
| `GET /api/v1/groups/{id}/meetings/{meetingId}` | Full operational meeting workspace | `MEETING_VIEW` | `{meeting,attendance,transactions,summary,financialPosition,fineRules,reconciliation}` | NFM |
| `GET /api/v1/groups/{id}/meetings/{meetingId}/attendance` | Attendance snapshot | `ATTENDANCE_VIEW` | array | NFM |
| `PATCH /api/v1/groups/{id}/meetings/{meetingId}/attendance` | JSON `attendance` | `ATTENDANCE_OPERATE` | updated array; meeting must be OPEN | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/cancel` | strict reason 3–2000 | `MEETING_OPERATE` | cancelled meeting; no active financial transactions | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/reconcile` | JSON `reconciliation` | `RECONCILIATION_OPERATE` | `201` reconciliation | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/close` | No request body is read | service `MEETING_CLOSE` policy | closed meeting; requires all attendance + current balanced signed reconciliation | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/google-meet` | No body; server creates Meet | `MEETING_OPERATE` / `meeting.create` | `{meeting,created,source,accessType?,cohost...}` | NFM |
| `PATCH /api/v1/groups/{id}/meetings/{meetingId}/google-meet` | strict manual `virtualMeetingUrl` | same | `{meeting,created,source:"MANUAL"}` | NFM |

## Savings, Social Fund, fines, and generic transactions

| Method and route | Purpose / contract | Auth / authorization | Success / idempotency | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups/{id}/meetings/{meetingId}/transactions` | Meeting transaction history | `FINANCIAL_VIEW` / `savings.view` | array | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/savings` | JSON `savings`; server derives amount from constitution | `FINANCIAL_OPERATE` | `201 {transaction,domain,idempotent}`; key required | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/social-fund` | JSON `social`; server derives amount | `FINANCIAL_OPERATE` | same; key required | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/fines` | JSON `fine`; server derives rule amount | `FINANCIAL_OPERATE` | same; key required | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/transactions/{transactionId}/reverse` | JSON `reversal` | `FINANCIAL_REVERSE` | `201`; same-key/same-fingerprint replay returns prior | NFM |

## Loans and repayments

| Method and route | Purpose / contract | Auth / authorization | Success / notable errors | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups/{id}/loans` | Operational requests + loan projections | `LOAN_VIEW` | `{requests,loans}` | NFM |
| `GET /api/v1/groups/{id}/loans/{loanId}` | Loan + repayments | `LOAN_VIEW` | `{loan,repayments}` | NFM |
| `GET /api/v1/groups/{id}/meetings/{meetingId}/loan-eligibility/{memberId}` | Eligibility + attendance | `LOAN_VIEW` | eligibility DTO | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/loan-requests` | JSON `loanRequest`; self-member omits `memberId` | contextual `LOAN_REQUEST` | `201` request; no idempotency key | MR-C only for ordinary-member self request |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/loan-requests/{requestId}/cancel` | JSON reason | contextual `LOAN_REQUEST`; self requester may cancel only own pending request | request row | MR-C for own request |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/loan-requests/{requestId}/approve` | JSON `loanApprove` | contextual `LOAN_DECIDE` + SOD | `201` decision | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/loan-requests/{requestId}/reject` | JSON `loanReject` | contextual `LOAN_DECIDE` + SOD | `201` decision | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/loan-requests/{requestId}/disburse` | JSON `loanDisburse` | contextual `LOAN_DISBURSE` + SOD | `201 {loan,transaction,idempotent}` | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/loans/{loanId}/repayments` | JSON `repayment` | contextual `LOAN_REPAY` | `201 {repayment?,transaction,idempotent}` | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/loans/{loanId}/transactions/{transactionId}/reverse` | JSON key | contextual `LOAN_OPERATE` | `201`; repayment must be latest; disbursement cannot have active repayment | NFM |
| `POST /api/v1/groups/{id}/loans/{loanId}/default` | JSON reason | contextual `LOAN_OPERATE` / `loan.default` | loan row; only overdue active-cycle loan | NFM |

## Share-out and Social Fund carry-forward

| Method and route | Purpose / contract | Auth / authorization | Success / idempotency | Ready |
|---|---|---|---|---|
| `GET /api/v1/groups/{id}/cycles/{cycleId}/shareout/readiness` | Snapshot blockers | `SHAREOUT_VIEW` | readiness object | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/shareout/prepare` | strict `{}`; server calculates entitlements | `SHAREOUT_PREPARE` | `201` share-out | NFM |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/shareout` | Share-out + entitlement/payout history | `SHAREOUT_VIEW` | object or null | NFM |
| `POST /api/v1/groups/{id}/cycles/{cycleId}/shareout/{shareoutId}/approve` | JSON key | `SHAREOUT_APPROVE` | share-out; idempotent | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/shareout/{shareoutId}/payouts` | JSON `payout` | `SHAREOUT_PAYOUT` | `201` payout; idempotent | NFM |
| `POST /api/v1/groups/{id}/meetings/{meetingId}/shareout/{shareoutId}/payouts/{payoutId}/reverse` | JSON key | `SHAREOUT_PAYOUT` / `shareout.reverse` | `201` reversal; idempotent | NFM |
| `POST /api/v1/groups/{id}/cycles/{cycleId}/shareout/{shareoutId}/complete` | strict `{}` | `SHAREOUT_COMPLETE` | completed share-out | NFM |
| `POST /api/v1/groups/{id}/cycles/{cycleId}/social-fund/carry-forward` | JSON target cycle + key | `SHAREOUT_OPERATE` / carry-forward permission | `201` transfer; idempotent | NFM |

## Reports and files

All routes require authentication. Report services enforce `REPORT_VIEW`/`REPORT_EXPORT` contextual access, including linked-member self access where implemented.

| Method and route | Output | Readiness |
|---|---|---|
| `GET /api/v1/groups/{id}/cycles/{cycleId}/reports/pdf` | cycle PDF attachment, private/no-store | MR-C, operational/admin |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/reports/excel` | cycle XLSX attachment, private/no-store | MR-C, operational/admin |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/meetings/{meetingId}/reports/pdf` | meeting PDF | MR-C, operational/admin |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/meetings/{meetingId}/reports/excel` | meeting XLSX | MR-C, operational/admin |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/members/{memberId}/reports/pdf` | member statement PDF | MR-C; self authorization is server-derived |
| `GET /api/v1/groups/{id}/cycles/{cycleId}/members/{memberId}/reports/excel` | member statement XLSX | MR-C; prefer PDF/JSON UX for V1 |

There is no JSON report route. The mobile client must not reproduce report calculations.

## Member self-service

| Method and route | Purpose / exact data shape | Auth | Ready |
|---|---|---|---|
| `GET /api/v1/me/groups` | Array with group/cycle/member IDs and codes, group/member status, operation mode, current participation, officer position/workspace | linked membership derived from session user | MR-C |
| `GET /api/v1/me/groups/{id}/activity?cycleId={uuid?}` | `{membership,summary,loan,shareout,loanRequest,cycles,activity}`; combined activity max 50 | linked active member; requested cycle must belong to member history | MR-C |
| `GET /api/v1/me/meetings` | read-only meeting array with group, date, mode, attendance, status | linked member via attendance snapshot | MR-C |
| `GET /api/v1/me/groups/{id}/meetings/{meetingId}` | `{meeting:{...,joinUrl},summary,contributions,refreshedAt}` | linked member present in attendance snapshot | MR-C |
| `GET /api/v1/me/google-meet-email` | `{googleMeetEmail}` | current user | MR-C |
| `PATCH /api/v1/me/google-meet-email` | strict nullable valid email ≤254 | current user; audited configured/not-configured only | MR-C |

Sanitized activity example:

```json
{
  "success": true,
  "data": {
    "membership": {"groupName":"Example Group","cycleNumber":2,"memberCode":"EX-001","memberName":"Example Member","membershipStatus":"ACTIVE","officerPosition":null,"location":{"community":"Example Community","lga":"Example LGA","state":"Example State"}},
    "summary": {"savingsShares":12,"savingsAmount":"12000.00","socialFundAmount":"600.00","finesAmount":"0.00","outstandingLoan":"0.00","shareoutAmount":null},
    "loan": null,
    "shareout": null,
    "loanRequest": null,
    "cycles": [{"id":"cycle-id-example","cycle_number":2,"status":"ACTIVE"}],
    "activity": []
  }
}
```

## Notifications

| Method and route | Purpose | Auth / scope | Success | Ready |
|---|---|---|---|---|
| `GET /api/v1/notifications` | Latest 100 own in-app rows; each row includes window `unread_count` | `notification.view`, recipient always session user | array | MR-C |
| `PATCH /api/v1/notifications/{id}/read` | Mark own row read | same; recipient condition in SQL | notification row | MR-C |
| `POST /api/v1/notifications/read-all` | Mark all own rows read | same | `{updated:number}` | MR-C |

No paging, preferences, device tokens, or native push endpoint exists.

## Membership requests

| Method and route | Purpose / contract | Auth / scope | Ready |
|---|---|---|---|
| `GET /api/v1/membership-requests` | query status/group UUID/search | `join_request.view`; assigned facilitator or scoped admin | NFM |
| `GET /api/v1/membership-requests/{id}` | Detail | same + service scope | NFM |
| `PATCH /api/v1/membership-requests/{id}` | status transition, optional decision notes/date; decisions require ≥5-char notes | `join_request.manage` + scope | NFM |
| `POST /api/v1/membership-requests/{id}/convert-to-member` | optional sex/DOB | `join_request.convert` + scope; request must qualify | NFM |

## Google integration

| Method and route | Behavior | Auth / scope | Ready |
|---|---|---|---|
| `GET /api/v1/integrations/google/connect` | Browser redirect to Google; sets OAuth-state cookie | `organization.manage` | WO |
| `GET /api/v1/integrations/google/callback` | Validates state/session, exchanges code, redirects to `/settings`; failure may be JSON | `organization.manage` | WO |
| `POST /api/v1/integrations/google/disconnect` | Revoke/remove organization connection | `organization.manage` | NFM |

Member mobile only consumes a server-authorized `joinUrl`; it never sees OAuth tokens.

## Public and location APIs

| Method and route | Purpose / contract | Auth / limit | Success | Ready |
|---|---|---|---|---|
| `GET /api/public/locations/states` | Public states | No | array | MR |
| `GET /api/public/locations/lgas?stateId={uuid}` | Public LGAs | No | array | MR |
| `GET /api/public/locations/communities?lgaId={uuid}` | Public communities | No | array | MR |
| `GET /api/public/groups?state_id={uuid}&lga_id={uuid}` | Visible public groups | No | array | MR, optional discovery feature |
| `GET /api/public/groups/{id}` | Public group profile | No | sanitized public DTO | MR |
| `GET /api/public/groups/{id}/constitution` | Public current signed constitution | No; only public group/document | PDF | MR-C |
| `POST /api/public/groups/{id}/join` | names, required Nigerian phone, optional email/location/message | No; 5/15 min per forwarded IP in memory | `201` request reference | NFM for member-first authenticated app |
| `POST /api/public/contact` | name, phone/email, category, message | No; 5/15 min per forwarded IP in memory | `201` request | NFM |
| `GET /api/v1/locations/states` | Authenticated states | any normal session | array | MR-C |
| `GET /api/v1/locations/lgas?stateId={uuid}` | Authenticated LGAs | any normal session | array / 404 state | MR-C |
| `GET /api/v1/locations/communities?lgaId={uuid}` | Authenticated communities | any normal session | array / 404 LGA | MR-C |

## Other

| Method and route | Purpose | Auth | Success | Ready |
|---|---|---|---|---|
| `GET /api/health` | DB liveness | No | `200 {status:"ok"}` or `503 {status:"unavailable"}` | MR for diagnostics; do not expose internals |
| `GET /api/v1/agent/group-creation-options` | Facilitator's project/state/LGA creation options | role includes FACILITATOR plus active/scoped SQL | array | NFM |

## API gaps affecting contract quality

- No OpenAPI document or generated client.
- Many operational responses expose database snake_case rows rather than stable named DTOs.
- Only list/project/group/user/facilitator routes have pagination; notifications and most operational lists do not.
- Not every mutation accepts an idempotency key. Loan request/decision/cancel, attendance, meeting lifecycle, and admin CRUD are retry-sensitive.
- No single JSON dashboard or JSON report endpoint.
- No explicit API version negotiation beyond `/api/v1` paths.

Primary sources: every `src/app/api/**/route.js`, schema files in `src/modules/**`, `src/lib/errors/response.js`.
