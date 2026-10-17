# Files, uploads, downloads, and reports

## Storage model

Private uploads are written through a server-side storage helper beneath a configured private root. The root defaults to operating-system temporary storage when `VSLA_PRIVATE_UPLOAD_ROOT` is absent. Clients receive metadata or authenticated file responses, never a filesystem path.

This is suitable for local/single-instance development. **Before production mobile file use, confirm that the deployed storage is persistent, backed up, and consistently visible to every application instance.** A temporary or instance-local volume is not a durable multi-instance design.

Source: `src/lib/private-storage.js`.

## Constitution documents

### Upload

`POST /api/v1/groups/{id}/constitution/{constitutionId}/document`

- Authentication and `CONSTITUTION_MANAGE` authorization are required.
- Content type: `multipart/form-data`.
- Part `file`: required PDF.
- Part `reason`: optional for an initial upload and required by service rules for a replacement.
- Maximum file size: 10 MiB.
- Validation checks the PDF MIME/extension contract plus PDF header and trailer; merely renaming a different file is insufficient.
- Success: `201` with document metadata; storage finalization and database state are handled defensively.

Native clients can construct multipart form data, but this is an operator workflow and is not recommended for member-first V1. Do not set the multipart boundary manually; let the networking library create it.

### Authenticated download

`GET /api/v1/groups/{id}/constitution/{constitutionId}/document`

- Authentication and `CONSTITUTION_VIEW` authorization are required.
- Returns binary `application/pdf` with private/no-store cache controls and a download disposition.
- Mobile must preserve the authenticated session during the binary request, write only to app-controlled temporary storage, invoke an OS PDF viewer/share sheet if desired, and delete temporary material according to the app's retention policy.

### Public download

`GET /api/public/groups/{id}/constitution` returns the current public signed constitution only when the group and document meet the public-visibility rules. Do not use this path to work around authenticated access.

Source: `src/app/api/v1/groups/[id]/constitution/[constitutionId]/document/route.js`, `src/app/api/public/groups/[id]/constitution/route.js`, `src/modules/onboarding/constitution-document.service.js`.

## Reconciliation signature

`POST /api/v1/groups/{id}/meetings/{meetingId}/reconcile` accepts an optional `signatureDataUrl` in its JSON body.

- It must be a PNG data URL when present.
- The encoded input is limited to 1.5 million characters.
- Decoded content must be between 200 bytes and 1 MiB and pass PNG magic-byte validation.
- Signature attribution comes from the authenticated server actor; the client must not manufacture signer identity.
- A signature is part of a high-risk operator reconciliation flow, not a member V1 feature.

If an operator phase adds signature capture, render the signature to PNG, avoid logging/base64 persistence, submit only over TLS, and clear local temporary data after a definitive server result. Do not queue a reconciliation or signature blindly for later offline replay.

Source: `src/modules/meetings/meeting.schemas.js`, `src/modules/meetings/meeting.service.js`, `src/lib/private-storage.js`.

## Generated reports

The server exposes six authenticated binary report endpoints:

| Report | PDF | Excel |
|---|---|---|
| Cycle | `GET /api/v1/groups/{id}/cycles/{cycleId}/reports/pdf` | `GET /api/v1/groups/{id}/cycles/{cycleId}/reports/excel` |
| Meeting | `GET /api/v1/groups/{id}/cycles/{cycleId}/meetings/{meetingId}/reports/pdf` | `GET /api/v1/groups/{id}/cycles/{cycleId}/meetings/{meetingId}/reports/excel` |
| Member statement | `GET /api/v1/groups/{id}/cycles/{cycleId}/members/{memberId}/reports/pdf` | `GET /api/v1/groups/{id}/cycles/{cycleId}/members/{memberId}/reports/excel` |

PDF responses are `application/pdf`; Excel responses use the XLSX MIME type. They are binary attachments with private/no-store behavior. Authorization is rechecked server-side. For member statements, the ordinary member's self-access remains server constrained; a client-supplied `memberId` never grants access.

There is no JSON report endpoint. A member-first app should use the JSON self-service activity and meeting endpoints for native screens, and use PDF only for an explicitly requested share/download. Excel is low-value for member V1. The app must not recreate report calculations.

Source: `src/app/api/v1/groups/[id]/cycles/[cycleId]/**/reports/*/route.js`, `src/modules/reports/`.

## Native file-handling policy

Do:

- stream/download binary data without coercing it to JSON;
- validate HTTP status and response MIME type before opening;
- use app-private cache/storage and platform sharing APIs;
- use synthetic files in development and non-PII staging fixtures;
- reauthenticate or show an authorization error instead of trying a public route;
- remove temporary signatures and reports when no longer needed.

Do not:

- expose server storage keys or construct storage paths;
- cache private financial reports indefinitely or in a public downloads folder by default;
- upload files through arbitrary member screens;
- treat filename extensions as sufficient content validation;
- place file bodies or data URLs in analytics/crash logs;
- calculate authoritative figures from a downloaded report.

## Readiness

| Capability | Classification | Reason |
|---|---|---|
| Authenticated PDF download | `MOBILE_READY_WITH_CAVEAT` | Binary/session handling and secure temporary storage must be proven. |
| Authenticated XLSX download | `MOBILE_READY_WITH_CAVEAT` | Same caveats; no strong V1 member need. |
| Public constitution PDF | `MOBILE_READY_WITH_CAVEAT` | Ready only for genuinely public groups/documents. |
| Constitution upload | `MOBILE_READY_WITH_CAVEAT` | Multipart is viable, but operator authorization and replacement reason apply. |
| Signature upload | `MOBILE_READY_WITH_CAVEAT` | Contract is usable; capture UX and high-risk online-only policy are required. |
| Server private storage in production | `BACKEND_CHANGE_REQUIRED` unless deployment durability is confirmed | Default temp/local storage does not prove persistence or multi-instance safety. |

