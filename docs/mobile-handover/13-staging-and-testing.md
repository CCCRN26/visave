# Staging and testing

## Safe target

Use `https://testvisave.gidacare.com` for mobile integration work only after the backend owner confirms it is the current staging deployment and confirms the build's Turnstile/session strategy. The URL was supplied for this handover but is not declared by an authoritative repository setting.

Do not test against `https://visave.gidacare.com`, real users, real phone numbers, or real financial records. Do not seed or reset any remote database from the mobile project.

## Accounts the project owner must provision

Credentials must be delivered through an approved secret-sharing channel, never committed to this repository, copied into this handover, or placed in issue screenshots.

| Alias | Required fixture/state | Purpose |
|---|---|---|
| `SUPER_ADMIN_TEST` | Active user; Super Admin role; synthetic organization/project/group data | Global/admin authorization and negative-scope tests. Not required for member V1 daily work. |
| `PROJECT_ADMIN_TEST` | Active project-scoped user with at least one in-scope and one out-of-scope group | Prove project scoping and that admin does not automatically receive special loan authority. |
| `STATE_COORDINATOR_TEST` | Active state-scoped user; groups inside and outside state | Prove geographic scoping and special-loan denials. |
| `FACILITATOR_PA_TEST` | Active assigned facilitator; active Program Assisted group/cycle; members and open meeting | Authorized PA operator behavior and Digital Access. |
| `FACILITATOR_MM_TEST` | Active assigned facilitator; Member Managed group | Prove view/Digital Access capability and denial of MM meeting/financial operations. |
| `CHAIRPERSON_PA_TEST` | Digitally linked active member; current active-cycle Chairperson in PA group | Special loan/close authority matrix. |
| `CHAIRPERSON_MM_TEST` | Digitally linked current Chairperson in MM group with an open meeting | MM operator workflows and Chair SOD exemption. |
| `RECORD_KEEPER_MM_TEST` | Digitally linked current Record Keeper in the same MM cycle | Meeting/financial operations, loan request/disbursement, decision denial, ordinary SOD behavior. |
| `MEMBER_TEST` | Digitally linked active member; active cycle membership; closed/open meeting history; savings, Social Fund, fine, loan/repayment and share-out fixtures | Main member-first vertical slice and empty/non-empty states. No officer assignment. |
| `FORCED_PASSWORD_MEMBER_TEST` | Digitally linked member with `must_change_password=true`; issued synthetic temporary credential; otherwise same access model | Forced-password routing and protected-route denial. Re-provision/reset after tests consume it. |

Officer accounts must remain system-role `VSLA_MEMBER` unless the actual fixture intentionally tests another role. Chairperson and Record Keeper authority comes from current cycle officer assignment, not a new system role.

## Fixture matrix

The staging dataset should provide synthetic, disposable records for:

- one active Program Assisted group and one active Member Managed group;
- a third group outside each scoped operator's authority;
- active and closed cycles, with effective-dated cycle memberships;
- current and expired officer assignments;
- physical, virtual, and hybrid meetings, including an open meeting with a safe test Meet URL;
- at least one closed meeting containing savings, Social Fund, fine, loan, repayment, and reconciliation data;
- a member with no activity for empty-state testing;
- pending/approved/rejected/cancelled loan-request cases and an active/closed/defaulted loan where safe;
- unread/read in-app notifications;
- an approved constitution and synthetic PDF document;
- no real PII, phone numbers, Google tokens, or production financial values.

If Twilio is enabled in staging, only the server-approved trial destination/template may be used. Mobile tests must never substitute recipients.

## First vertical-slice acceptance

### Authentication gate

- [ ] Complete a real-device Turnstile challenge through the approved native design.
- [ ] Login returns 200 and the client captures a session without printing it.
- [ ] `GET /api/v1/auth/me` succeeds immediately and after an app restart when persistence is intended.
- [ ] A wrong password produces the documented generic authentication failure without revealing account existence.
- [ ] A protected route returns `PASSWORD_CHANGE_REQUIRED` for the forced-change fixture.
- [ ] Password change enforces 12–128 characters and confirmation equality.
- [ ] Logout revokes the server session, clears client state, and makes the next protected request return 401.
- [ ] Expired/revoked sessions route to login without retry loops.

### Member slice

- [ ] `GET /api/v1/me/groups` shows only the linked member's groups.
- [ ] Activity uses the server summary/current-loan/share-out data and does not recalculate balances.
- [ ] Meeting list/detail shows correct physical/virtual/hybrid behavior.
- [ ] Join action appears only when `joinUrl` is returned and opens externally.
- [ ] Loan request omits `memberId`, sends a fresh idempotency key, and handles validation/conflict responses.
- [ ] Notifications can be listed, marked read individually, and marked all read.
- [ ] Pull-to-refresh replaces stale server-backed data and preserves a clearly labelled offline snapshot.

### Negative authorization

- [ ] A member cannot retrieve another member's statement by changing `memberId`.
- [ ] A PA facilitator cannot operate an unassigned group.
- [ ] An assigned facilitator cannot perform MM financial operations.
- [ ] Project Admin and State Coordinator cannot approve/disburse special loans solely because of their system role.
- [ ] Record Keeper cannot decide a loan and cannot violate same-loan SOD.
- [ ] Expired officer assignments confer no current authority.
- [ ] UI hidden-state tests are paired with direct API denial tests.

## Contract and error testing

For each mobile request, cover success plus 400 validation, 401 session loss, 403 scope/permission, 404 hidden-or-missing resource, 409 stale workflow/conflict, 429 throttling where applicable, and 5xx safe failure. Preserve the server's `error.code`, `error.message`, and `error.details` for centralized interpretation, but show user-safe copy.

Financial and workflow mutation tests must use a new client idempotency key for a new intent and the same key only for a retry of the exact same intent. Verify duplicate retry behavior rather than assuming every POST is idempotent; the API catalog marks routes that actually require keys.

## Offline and poor-network testing

- Read cached member data only as a labelled snapshot with last-updated time.
- On reconnect, revalidate session, groups, activity, meetings, and notifications.
- Do not queue financial posts, attendance, reconciliation, close, loan decisions, disbursement, repayment, reversals, or share-out operations.
- Test request timeout, DNS/TLS failure, connection loss after send, duplicate taps, and app termination during a response.
- When a mutation result is uncertain, fetch authoritative server state before offering retry.

## Binary/media testing

- Test authenticated PDF/XLSX downloads with the same session transport used by JSON calls.
- Verify MIME/status before opening and confirm temporary files are app-private and removed.
- Use a small synthetic PDF, a >10 MiB rejection case, a false-PDF case, valid/invalid PNG data URLs, and boundary sizes.
- Never upload screenshots containing real PII or signatures.

## Repository test references

The server has Node tests and acceptance scripts covering core contracts. Useful references include `tests/`, `scripts/member-self-service-acceptance.js`, `scripts/digital-access-route-acceptance.js`, `scripts/phase2fa-member-managed-acceptance.js`, `scripts/reconciliation-position-acceptance.js`, `scripts/phase2c-production-hardening.js`, and `scripts/completion-acceptance.js`. These scripts may create/delete acceptance fixtures and must not be aimed at staging or production without explicit backend-owner procedure.

## Release evidence required

Before a mobile production build, retain sanitized evidence of:

1. device/OS matrix and build identifier;
2. Turnstile challenge and session restoration on physical Android and, if supported, iOS devices;
3. role/mode negative tests;
4. forced password change and logout revocation;
5. network-loss and duplicate-mutation handling;
6. file privacy and log-redaction checks;
7. backend/proxy rate-limit and storage-readiness sign-off;
8. product-owner approval of the V1 role/scope.

