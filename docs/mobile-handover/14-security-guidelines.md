# Security guidelines for mobile development

The server remains the source of truth for identity, scope, workflow state, and money. Mobile UI restrictions are usability features, not authorization controls.

## Do

- Use HTTPS and the exact environment allow-list for every API and download request.
- Keep the finalized session credential in Expo SecureStore or the platform Keychain/Keystore where the chosen transport makes it app-accessible; use a security-reviewed native cookie jar if the HttpOnly cookie model is retained.
- Keep non-sensitive cached DTOs in app-private storage, minimize retention, label stale/offline data, and clear user data on logout or account/session invalidation.
- Let the server derive the signed-in member for `/api/v1/me/**` and self-request flows.
- Re-fetch server state after uncertain mutations, conflicts, app resume, and role/operation-mode changes.
- Generate high-entropy idempotency keys on-device for routes that require them, persist a key only for the lifetime of that exact pending intent, and never reuse it for different content.
- Redact request bodies and headers in production telemetry. Use server error codes and a correlation mechanism if one is introduced.
- Validate local input for user experience, then accept server validation and authorization as authoritative.
- Use OS-provided external URL/PDF/share facilities and app-private temporary files.
- Threat-model rooted/jailbroken devices, screen capture, clipboard use, backups, deep links, and notification payloads before handling sensitive information.

## Do not

- Do not embed server secrets, database credentials, Google refresh tokens, token-encryption keys, Twilio credentials, or the Turnstile secret.
- **Do not connect directly to PostgreSQL.**
- Do not trust cached roles, permissions, officer positions, group mode, or member IDs as authorization.
- Do not calculate authoritative balances, interest, eligibility, share-out, reconciliation, or ledger amounts.
- Do not accept/substitute arbitrary `memberId` for own-data APIs or assume an ID in a URL creates access.
- Do not disable TLS or accept invalid certificates for staging convenience.
- Do not log passwords, temporary passwords, Turnstile tokens, session cookies/tokens, signature data URLs, full request bodies, private document contents, or real PII.
- Do not put sensitive credentials in AsyncStorage, source code, Expo public variables, EAS-visible public configuration, crash metadata, analytics, or clipboard.
- Do not bypass Turnstile or use test keys in production.
- Do not bypass `must_change_password`; route immediately to the forced-change flow and prevent normal app navigation until it succeeds.
- Do not invent permissions in UI code or broaden access because the web UI appears to expose a control.
- Do not blindly retry POST/PATCH/DELETE, and do not queue financial/workflow writes offline.
- Do not call Twilio or Google provider APIs with server credentials from the app.

## Credential and session handling

Current authentication uses an opaque, random server session stored as an HttpOnly cookie and stored only as a SHA-256 hash in PostgreSQL. It is not a JWT and the client must not attempt to parse it. The session lasts eight hours unless revoked/expired sooner.

If the existing cookie is retained, use a reviewed cookie solution that preserves HttpOnly/Secure semantics as far as the native stack allows and prove capture, persistence, expiry, deletion, binary-request use, and multi-account cleanup. If the backend introduces a mobile bearer/refresh contract, store refresh/long-lived material in SecureStore/Keychain/Keystore, keep short-lived access material in memory where practical, rotate/revoke it server-side, and never invent a token format in the app.

Biometric unlock, if selected, only gates local access to an already established credential. It does not replace server authentication, session expiry, Turnstile, or password change.

## Authentication responses

- Treat 401 as an invalid/missing server session: clear local authenticated state and route to login once.
- Treat `PASSWORD_CHANGE_REQUIRED` as a dedicated navigation state, not a generic denial.
- Treat 403 as insufficient authority/current scope; refresh context and do not retry automatically.
- Never disclose whether an account exists based on locally customized login/reset messages.
- The assisted reset endpoint returns a one-time temporary password. Display it only to the authorized operator for the immediate handover workflow; do not persist, copy to logs, analytics, screenshots, or background notifications.

## Financial and workflow integrity

**THE MOBILE CLIENT MUST NOT IMPLEMENT ITS OWN AUTHORITATIVE FINANCIAL LOGIC.**

Display server-returned amounts as decimal currency values without floating-point recomputation. Treat meeting state, active cycle, participation dates, constitution rules, eligibility, actor attribution, segregation of duties, and closing/reconciliation prerequisites as server decisions. A disabled button never replaces an API authorization check.

For uncertain outcomes, query the relevant meeting/activity/loan/transaction endpoint. A timeout after sending does not mean failure. Reusing the original idempotency key is permitted only where the catalog confirms an idempotent mutation and the payload is unchanged.

## Sensitive data and privacy

- Request and cache the minimum fields needed for the current screen.
- Avoid showing private amounts in push notifications, lock-screen previews, deep-link parameters, or analytics.
- Clear downloaded reports/signatures from temporary storage and exclude sensitive caches from cloud backup where supported.
- Mask sensitive values in screenshots and support logs. Use synthetic staging identities.
- On logout, revoke server state first when online, then clear the local credential, cache, query state, temporary files, and user-specific navigation state. If the network is unavailable, clear locally and mark server revocation for an explicit safe follow-up; do not silently claim remote logout succeeded.

## Links, files, and WebViews

- Allow only expected HTTPS Google Meet URLs before external launch.
- Do not inject authentication cookies or arbitrary JavaScript into unrelated WebViews.
- A Turnstile WebView, if approved, must use an allow-listed HTTPS origin, narrow navigation policy, ephemeral handling where appropriate, safe token hand-off, and no general browsing capability.
- Check MIME type/status for PDFs/XLSX and do not render untrusted HTML as an error page.
- Do not expose server filesystem/storage keys.

## API and build hygiene

- Production builds must disable verbose networking and state-debugging tools.
- Dependency updates, mobile permissions, signing credentials, and EAS/App Store/Play Console access require least privilege and owner review.
- Keep signing/distribution secrets outside the repository and outside `EXPO_PUBLIC_*` values.
- Never include a production cookie or captured provider token in Postman, test fixtures, screenshots, or bug reports.
- Implement an application-wide redaction list including `authorization`, `cookie`, `set-cookie`, `password`, `temporaryPassword`, `turnstileToken`, `signatureDataUrl`, and likely PII fields.

Source anchors: `src/lib/auth/session.js`, `src/modules/auth/auth.service.js`, `src/lib/audit/audit.service.js`, `src/lib/security/turnstile.js`, `src/modules/group-access/group-access.service.js`, `src/modules/meetings/financial.service.js`, `src/modules/loans/loan.service.js`, `next.config.mjs`.

