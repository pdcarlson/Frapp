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

**This check gates URL *issuance*, not the upload.** A signed upload URL cannot pin a content type — the client sets its own `Content-Type` on the PUT and the API never sees the bytes — so the bucket's `allowed_mime_types` column is the server-side type gate, exactly as the bucket's size column is the server-side size gate (§3). It gates the **declared header, never the bytes**, so it does not stop hostile bytes being stored; it constrains the type they are served as. Validating here is still worth doing — it makes a rejection a readable error instead of a failed PUT — but it is not a second enforcement point. For the measured request/response, what stops a browser rendering a stored object, and what was deliberately not measured, see `packages/validation/src/upload-allowlists.ts` § What the bucket allowlist actually enforces (#1230).

### 2. Allowed File Extensions
Validate the filename with `isAllowedUploadExtension(kind, filename)`. If the extension is not in the kind, reject. Blocklists must not be used.

### 3. Size
`MAX_UPLOAD_BYTES` (25 MB / 26214400) is the shared cap for the **member-upload** buckets and matches their `file_size_limit`. It is **not** universal: `chat-archive` is 104857600 (100 MB), and `supabase/config.toml`'s global `[storage] file_size_limit` is 104857600 to accommodate it. Per-bucket values are owned by [`spec/architecture/README.md`](../../../spec/architecture/README.md) § 7. Clients must check `file.size` via `inspectUploadFile` / `isWithinUploadSizeLimit` before requesting a signed URL.

Every cap above bounds **one object**. The Discord archive importer additionally bounds the **total**: `MAX_ARCHIVE_IMPORT_BYTES` (20 GB) per import and `MAX_ARCHIVE_CHAPTER_BYTES` (50 GB) per chapter, both in `packages/validation/src/upload-allowlists.ts` and enforced in `DiscordImportService.requestUploadUrls` before any manifest row is written or any URL minted (#1243). Without them, `MAX_UPLOAD_URL_BATCH` capped a single *request* at 100 tickets while nothing capped the loop, and `CustomThrottlerGuard` bounds request rate rather than bytes. The projection is a SQL function (`discord_import_projected_archive_bytes`) because it has to exclude `purged` imports — the purge sweeps their storage objects but leaves their manifest rows, so a plain sum would make the quota ratchet one way and never release. These ceilings are **abuse ceilings, not a capacity plan** for the hosted project; that question is tracked separately (#1235, #1403). They carry the same issuance-only caveat as everything else in this section, and for the same structural reason: `byte_size` is client-declared and the browser PUTs straight to storage, so the honest description is a guard, not a byte-level control. A real control needs reconciliation against storage listings, which is the retention-sweep shape in #1246.

The four signed-upload-URL requests (chat, backwork, chapter documents, service-entry proof) also accept an optional `size_bytes`, checked with `isWithinUploadSizeLimit` before the URL is issued. It has the same issuance-only caveat as §1's content-type gate: the field is optional and nothing forces a caller to send an accurate value — a caller can omit it entirely, exactly as every client did before this field existed. So the bucket's `file_size_limit` column remains the only gate that actually constrains the bytes written to storage; the request-level check only turns a declared oversize into a readable 400 instead of a failed or wasted PUT.

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
