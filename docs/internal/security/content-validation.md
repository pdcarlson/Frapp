# Content Validation Security Specification

## Overview
When generating signed URLs for secure file uploads (such as uploading to Supabase Storage), we must validate the content before handing out a signed URL to prevent malicious uploads or storage abuse.

The allowlists live in **one place**: `@repo/validation` (`packages/validation/src/upload-allowlists.ts`), kinds `image`, `proof`, `document`, and `archive`. API services, web upload pages, and the chat composer import those helpers. Do not copy the MIME or extension lists into a service or page — that is how `image/gif` drifted (Documents accepted it; Backwork silently refused it client-side).

## Validations Required

### 1. Allowed Content Types
Validate `contentType` with `isAllowedUploadMime(kind, contentType)` for the route's kind. **IMPORTANT**: SVG files (`image/svg+xml`, `.svg`) must **never** be added to these kinds without an explicit and robust server-side sanitization step. SVGs can contain embedded JavaScript `<script>` tags, leading to Stored XSS when rendered in the user's browser.

Kinds:

- `image` — avatars and chapter logos: `image/jpeg`, `image/png`, `image/gif`, `image/webp`
- `proof` — service-hour receipts: images plus `application/pdf`
- `document` — chapter files, backwork, and chat attachments: images, PDF, Open XML Office (`.docx`/`.xlsx`/`.pptx`), **legacy Office** (`application/msword`, `application/vnd.ms-excel`, `application/vnd.ms-powerpoint` — `.doc`/`.xls`/`.ppt`), `text/plain`, `text/csv`
- `archive` — Discord archive import only, on **both** its paths: the signed-URL upload path (`DiscordImportService`) and the bot export path (`DiscordExportWorkerService`). A wider set including video and audio, and a 100 MB ceiling (`MAX_ARCHIVE_UPLOAD_BYTES`). It is held **off** `MAX_UPLOAD_BYTES` and off the `document` list on purpose — widening those to cover a one-off import would raise the ceiling on every member upload. SVG stays absent here too. See the header comment in `packages/validation/src/upload-allowlists.ts`.

Legacy Office stays on `document` because the API and every matching storage bucket already accept those types. The web clients had omitted them from `accept`/maps; completing the client is the decision. Dropping them server-side would reject files the buckets still store.

**This check gates URL *issuance*, not the upload.** A signed upload URL cannot pin a content type — the client sets its own `Content-Type` on the PUT and the API never sees the bytes — so the bucket's `allowed_mime_types` column is the server-side type gate, exactly as the bucket's size column is the server-side size gate (§3). It gates the **declared header, never the bytes**, so it does not stop hostile bytes being stored; it constrains the type they are served as. Validating here is still worth doing — it makes a rejection a readable error instead of a failed PUT — but it is not a second enforcement point. For the measured request/response, what stops a browser rendering a stored object, and what was deliberately not measured, see `packages/validation/src/upload-allowlists.ts` § What the bucket allowlist actually enforces (#1230).

### 2. Allowed File Extensions
Validate the filename with `isAllowedUploadExtension(kind, filename)`. If the extension is not in the kind, reject. Blocklists must not be used.

### 3. Size
`MAX_UPLOAD_BYTES` (25 MB / 26214400) is the shared cap for the **member-upload** buckets and matches their `file_size_limit`. It is **not** universal: `chat-archive` is 104857600 (100 MB), and `supabase/config.toml`'s global `[storage] file_size_limit` is 104857600 to accommodate it. Per-bucket values are owned by [`spec/architecture/README.md`](../../../spec/architecture/README.md) § 7. Clients must check `file.size` via `inspectUploadFile` / `isWithinUploadSizeLimit` before requesting a signed URL.

Every cap above bounds **one object**. The Discord archive importer additionally bounds the **total**, and this section owns those two numbers: `MAX_ARCHIVE_IMPORT_BYTES` (20 GiB) per import and `MAX_ARCHIVE_CHAPTER_BYTES` (50 GiB) per chapter, both in `packages/validation/src/upload-allowlists.ts` (#1243). Without them, `MAX_UPLOAD_URL_BATCH` capped a single *request* at 100 tickets while nothing capped the loop, and `CustomThrottlerGuard` bounds request rate rather than bytes.

Enforcement is in `discord_import_register_files`, the SQL function **both** import paths register through — the browser-upload path via `DiscordImportService.requestUploadUrls`, and the bot path via `DiscordExportWorkerService` before it fetches anything from Discord. Registration and enforcement are one transaction on purpose: split into a check and then a write, ten concurrent mint requests all passed the same pre-batch total and the ceiling multiplied by the concurrency. Recorded sizes are monotonic for the same class of reason — a re-registered path may raise its `byte_size`, never lower it, or the upsert becomes a way to erase the accounting for objects already in the bucket. `purged` and `purging` imports are both excluded from the sum; the purge leaves manifest rows behind, so counting them would make the quota ratchet one way and never release.

These are **abuse ceilings, not a capacity plan** for the hosted project; that question is tracked separately (#1235, #1403). They carry the same issuance-only caveat as everything else in this section: `byte_size` is client-declared on the upload path, and NULL on any row whose size was never known, so the ledger can under-count real storage. A control that cannot be under-declared needs reconciliation against storage listings, which is the retention-sweep shape in #1246.

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
