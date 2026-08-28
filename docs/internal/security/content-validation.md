# Content Validation Security Specification

## Overview
When generating signed URLs for secure file uploads (such as uploading to Supabase Storage), we must validate the content before handing out a signed URL to prevent malicious uploads or storage abuse.

The allowlists live in **one place**: `@repo/validation` (`packages/validation/src/upload-allowlists.ts`), kinds `image`, `proof`, and `document`. API services, web upload pages, and the chat composer import those helpers. Do not copy the MIME or extension lists into a service or page — that is how `image/gif` drifted (Documents accepted it; Backwork silently refused it client-side).

## Validations Required

### 1. Allowed Content Types
Validate `contentType` with `isAllowedUploadMime(kind, contentType)` for the route's kind. **IMPORTANT**: SVG files (`image/svg+xml`, `.svg`) must **never** be added to these kinds without an explicit and robust server-side sanitization step. SVGs can contain embedded JavaScript `<script>` tags, leading to Stored XSS when rendered in the user's browser.

Kinds:

- `image` — avatars and chapter logos: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- `proof` — service-hour receipts: images plus `application/pdf`
- `document` — chapter files, backwork, and chat attachments: images, PDF, Open XML Office (`.docx`/`.xlsx`/`.pptx`), **legacy Office** (`application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint` — `.doc`/`.xls`/`.ppt`), `text/plain`, `text/csv`

Legacy Office stays on `document` because the API and every matching storage bucket already accept those types. The web clients had omitted them from `accept`/maps; completing the client is the decision. Dropping them server-side would reject files the buckets still store.

### 2. Allowed File Extensions
Validate the filename with `isAllowedUploadExtension(kind, filename)`. If the extension is not in the kind, reject. Blocklists must not be used.

### 3. Size
`MAX_UPLOAD_BYTES` (25 MB / 26214400) is the shared cap, matching `supabase/config.toml` and every bucket `file_size_limit`. Clients must check `file.size` via `inspectUploadFile` / `isWithinUploadSizeLimit` before requesting a signed URL. The signed-URL request itself does not carry a byte length — the bucket column is still the server-side size gate.

## Error Handling
If either validation fails, the service must throw a `BadRequestException` immediately, returning an HTTP 400 response and preventing the signed URL from being generated.

## SVG Upload Risks
The `image/svg+xml` content type and `.svg` extension must **never** be included in these allowlists unless rigorous, server-side SVG sanitization is performed, as SVGs can embed arbitrary JavaScript (XSS).

## Affected Services
- `UserService` (avatars) — kind `image`
- `ChapterService` (logos) — kind `image`
- `ServiceEntryService` (proof) — kind `proof`
- `ChapterDocumentService` (chapter files) — kind `document`
- `BackworkService` (academic library) — kind `document`
- `ChatService` (attachments) — kind `document`

Bucket SQL in `supabase/migrations/` mirrors these kinds with comment cross-references. Do not edit shipped migration DDL to change a MIME list; add a new migration.
