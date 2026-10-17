# Errors and status codes

## Envelope

```json
{"success":false,"error":{"code":"CONFLICT","message":"Resource already exists","details":{}}}
```

Unknown exceptions are logged server-side and returned as `500 INTERNAL_ERROR` with a generic message.

## HTTP handling

| HTTP | Meaning in this API | Mobile behavior |
|---:|---|---|
| 200/201 | Success | Use `data`; 201 is not evidence a retry is safe unless response says `idempotent` |
| 400 | Validation/domain input/Turnstile/Google input error | Keep form, attach `details.fieldErrors` where present, do not retry unchanged |
| 401 | Missing/invalid/expired/revoked session or bad login | For protected calls clear local session state and show login; for login show invalid credentials |
| 403 | Authenticated but denied, or password change required | If code is password-change, route there; otherwise show permission message, not login |
| 404 | Resource hidden/not found in scope | Pop stale detail, refresh parent; avoid revealing cross-scope existence |
| 409 | Current state/conflict/idempotency misuse | Refresh authoritative state; never blindly repeat with a new key |
| 422 | File/signature semantic validation | Keep form and request a valid file/signature |
| 429 | Process-memory rate limit | Disable/retry after delay; no `Retry-After` header exists |
| 500 | Unexpected server failure | Generic retry/support message; do not log request secrets |
| 502/503 | External provider/config unavailable or health failure | Preserve local form, retry later; do not bypass provider checks |

## Authentication and security codes

| Code | Status | When | Mobile action |
|---|---:|---|---|
| `AUTHENTICATION_REQUIRED` | 401 | No valid active session; invalid login uses same code | Login or invalid-credentials message depending request |
| `PASSWORD_CHANGE_REQUIRED` | 403 | Normal route called by forced-change user | Navigate to forced password screen |
| `PASSWORD_CHANGE_NOT_REQUIRED` | 409 | Change endpoint used by normal account | Refresh `/auth/me`; leave forced flow |
| `PASSWORD_CHANGE_FAILED` | 409 | Concurrent/update failure | Retry once after session check |
| `SELF_ASSISTED_RESET_NOT_ALLOWED` | 403 | Actor targets self | Use supported password flow; do not retry |
| `ASSISTED_RESET_TARGET_INELIGIBLE` | 409 | Target not active | Refresh target |
| `ASSISTED_PASSWORD_RESET_DENIED` | 403 via `FORBIDDEN` envelope in current constructor use | Scope/role denial | Hide action after refresh |
| `TURNSTILE_REQUIRED` | 400 | Enabled and token absent | Run challenge |
| `TURNSTILE_INVALID` | 400 | Provider failure, oversized token, action/hostname mismatch | Reset challenge and retry manually |
| `TURNSTILE_UNAVAILABLE` | 503 | Network/provider/malformed response | Retry later; do not bypass |
| `TURNSTILE_CONFIGURATION_ERROR` | 503 | Server config invalid | Stop and alert operator |
| `RATE_LIMITED` | 429 | Login or public form exceeds process limit | Back off; avoid background retry |

## Authorization/scope codes

| Code | Meaning / behavior |
|---|---|
| `FORBIDDEN` | Generic authorization failure. Some custom denial strings are passed as the message while code remains `FORBIDDEN` |
| `GROUP_ACTION_DENIED` | Message used by contextual group denial; envelope code remains `FORBIDDEN` |
| `USER_SCOPE_DENIED`, `ROLE_ASSIGNMENT_DENIED` | Management scope/role ceiling denial; normally envelope code `FORBIDDEN` |
| `AGENT_SETUP_SCOPE_DENIED`, `AGENT_SETUP_ENDED_AFTER_HANDOVER` | Facilitator onboarding authority absent/ended; normally `FORBIDDEN` |
| `MEMBER_STATEMENT_ACCESS_DENIED`, `REPORT_ACCESS_DENIED` | Report service denies actor |

## Financial and meeting codes

| Code | Status | Meaning / recommended behavior |
|---|---:|---|
| `SAVINGS_ALREADY_RECORDED` | 409 | Refresh meeting; offer authorized reversal rather than duplicate |
| `SOCIAL_FUND_ALREADY_RECORDED` | 409 | Same |
| `RECONCILIATION_SIGNATURE_REQUIRED` | 422 | Recapture a meaningful PNG signature |
| `BORROWER_NOT_PRESENT` | 400 | Attendance must be PRESENT; refresh meeting |
| `LOAN_REQUEST_ALREADY_OPEN` | 409 | Show existing request; refresh activity |
| `LOAN_CONTEXT_MISMATCH` | 409 | IDs do not belong to current group/cycle; stop and refresh |
| `LOAN_TERMS_INCOMPLETE` | 400 | Constitution cannot support lending; operator fix required |
| `LOAN_SEPARATION_OF_DUTIES_VIOLATION` | 403 | Different actor required unless explicit exemption |
| `LOAN_REPAYMENT_REVERSAL_ORDER_INVALID` | 409 | Only latest active repayment can be reversed |
| `FINAL_RECONCILIATION_REFRESH_NOT_ALLOWED` | 409 | State does not qualify; reload closeout |
| `FINAL_RECONCILIATION_UNEXPECTED_ACTIVITY` | 409 | Investigation required; show transaction types from details cautiously |
| `SHAREOUT_SNAPSHOT_STALE` | 409 | Recalculate/reprepare on server |
| `SHAREOUT_COMPLETED_PAYOUT_REVERSAL_NOT_ALLOWED` | 409 | Completed share-out is immutable |
| `CYCLE_PARTICIPANTS_REQUIRED`, `CYCLE_OFFICERS_INCOMPLETE`, `CYCLE_OFFICER_NOT_PARTICIPANT` | 409 | Resolve onboarding blockers |
| `INVALID_CYCLE_DATES` | 400 | Correct specific date field from details |

## Digital Access and files

| Code | Status | Behavior |
|---|---:|---|
| `DIGITAL_ACCESS_REQUIRES_ACTIVE_MEMBER` | 400 | Activate/correct member first |
| `MEMBER_ALREADY_LINKED`, `USER_ALREADY_LINKED`, `USER_EMAIL_ALREADY_EXISTS` | 409 | Refresh link state; do not expose another account's data |
| `INVALID_MEMBER_USER_LINK` | 400 | Selected account unavailable |
| `CONSTITUTION_DOCUMENT_INVALID_TYPE` | 422 | Select actual `.pdf` with PDF signature/end marker |
| `CONSTITUTION_DOCUMENT_TOO_LARGE` | 422 | Keep ≤10 MiB |
| `CONSTITUTION_DOCUMENT_REPLACEMENT_REASON_REQUIRED` | typically 400/409 | Supply a replacement reason |
| `PUBLIC_CONSTITUTION_DOCUMENT_NOT_FOUND` | 404 | Hide public download |

## Google codes

Material codes include `GOOGLE_CONFIGURATION_MISSING` (503), `GOOGLE_NOT_CONNECTED` (409), `GOOGLE_CONNECTION_DENIED` (400), `GOOGLE_SCOPE_MISSING` (400), `GOOGLE_REFRESH_TOKEN_MISSING` (400), `GOOGLE_AUTHORIZATION_REQUIRED` (503), `GOOGLE_EMAIL_UNAVAILABLE` (400), `GOOGLE_MEET_ACCESS_TYPE_INVALID` (503), `GOOGLE_INVALID_RESPONSE` (502), `GOOGLE_RATE_LIMITED` (provider-mapped), `GOOGLE_TIMEOUT`, and `GOOGLE_UNAVAILABLE`. Member join does not call Google APIs; it only receives a validated URL.

## Important implementation nuance

`AuthorizationError("SOME_REASON")` does **not** make `SOME_REASON` the error code; its code stays `FORBIDDEN` and the string is the message. Only `new AppError(message, code, status)` produces that domain code. Client logic must follow actual `error.code`, not examples in old documentation.

Sources: `src/lib/errors/index.js`, `src/lib/errors/response.js`, all service `AppError` sites, tests.
