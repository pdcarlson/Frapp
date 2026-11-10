# Chapter Documents

A "Chapter Files" storage area for organizational documents (bylaws, constitutions, meeting agendas, etc.), separate from Backwork which is strictly for academic materials.

## Permissions

- `chapter_docs:upload` — Upload new documents.
- `chapter_docs:manage` — Delete documents, create/rename/delete folders.
- Reads are gated on `members:view`, which every seeded role either holds or clears via the `*` wildcard (President's seeded set is `['*']` alone) — so in practice every member can view and download, but the controller's class-level gate is a permission rather than an all-members bypass. Upload and management need their own `chapter_docs:*` permissions.

## Structure

- Documents are organized into an optional flat folder structure (one level deep). A document belongs to zero or one folder.
- Folders have a name and a sort order. Documents without a folder are filed at the root; the dashboard rail surfaces them under a **No folder** view, alongside an **All files** view that ignores the folder filter entirely.
- A folder's name is unique within a chapter. Two chapters may each have a folder of the same name.
- A folder exists independently of its contents: it can be created empty, and it survives having its last document removed.

## Folder management

Officers with `chapter_docs:manage` create, rename, reorder, and delete folders; every member can list them.

- **Create** — names are trimmed, and a name that is empty (or only whitespace) is rejected. A new folder is appended to the end of the display order unless an explicit position is given.
- **Rename** — documents record their folder by *name*, so renaming a folder re-files every document in it. Renaming onto a name already used in the chapter is rejected.
- **Reorder** — folders are listed by sort order, then by name as a tiebreak.
- **Delete** — see Edge Cases below.
- **Uploading into an unknown folder still works.** Naming a folder that does not exist on upload registers it, which is how folders came into being before they were manageable. It is not an error.

## Search

Document listing accepts an optional case-insensitive substring match on the title, combinable with the folder filter. Search is scoped to the caller's active chapter. `%` and `_` in a query are matched literally, not as wildcards.

**Both apps search, filters and sort on the client** *(2026-11-09, #3852; Shawn's idea. Mobile too since #3938, Shawn's ask)*. Web `/documents` and mobile's Documents screen (s12) each read the chapter's whole library once (`GET /v1/documents` with no `search` or `folder`) and do the rest in memory, as `/backwork` does, through one shared implementation (`packages/hooks/src/document-library.ts`, reusing `packages/hooks/src/fuzzy-match.ts`, and the `useDocumentLibrary` hook beside it for the roster, the semester window and the clock). Where mobile differs, the bullet says so:

- **Search** matches the title, description, uploader's name, folder and document type: every query word must match a word, a word's start, or a near miss (backwork's typo tolerance), or the query must appear anywhere in that text, as the server's title search matched ("laws" finds "bylaws", and `%` or `_` is just a character). A query word also matches the file's format group by its words (`FILE_KIND_WORDS` in `document-library.ts`: "pdf"; "word", "doc", "docx"; "slides", "slide", "powerpoint", "presentation", "deck"; "spreadsheet", "excel", "sheet", "sheets", "csv"; "image", "photo", "picture"), exactly or by their start from three letters, never as a near miss, so "work" doesn't find Word files. It works offline over the library already loaded.
- **File type** *(2026-11-09, #3938; Shawn's addition, after Google Drive's Type filter)* groups each file as PDF, Word (doc, docx, odt, rtf), Slides (ppt, pptx, key, odp), Spreadsheet (xls, xlsx, csv, ods), Image, or Other, read from its declared `content_type`, or, when that is null (rows filed before 2026-08-31) or the generic `application/octet-stream`, from the extension of the stored filename in `storage_path` (`fileKind`). The groups name more formats than the upload allowlist (`packages/validation/src/upload-allowlists.ts`) accepts today: odt, rtf, key, odp and ods can't be uploaded, and are grouped only so a file that arrives some other way still lands in the right place; an allowed `txt` file is Other. It offers only the groups some file is in, in that order, plus a picked group whose last file has gone, so the list says nothing matches.
- **Uploaded by** offers only people the chapter roster can name who have uploaded something. A departed member's files keep showing, just without a name, and a filter on someone who has since left the roster is dropped. Someone still on the roster stays picked after their last file goes, and the list says nothing matches.
- **Date added** offers any time; this semester, which is the chapter's own window from [semester-rollover.md](semester-rollover.md) (after the end of the most recently created archive's `end_date` day, or everything before a first rollover), the archive picked and the day read as the API's points window picks and reads them (`findLatestByChapter`, `resolveWindowSince('semester')`), and offered only once the archives have loaded; the last 30 days; or, on web only, a custom from and to range, inclusive and read in the viewer's timezone (mobile waits on a native date picker, which needs a store build). A custom range with no dates set filters nothing. The windows move while the page stays open.
- **Sort** orders by name A to Z (the default, and the order before #3852), newest first, oldest first, or uploader A to Z. The chosen order applies whether or not a search is typed.
- **Rows** read "Uploaded Sep 26 by Ryan Castellano · …" when the roster can name the uploader. Mobile's line stops before the effective date and description, which it searches but has no room to draw.
- **Delete** is offered to `chapter_docs:manage` holders and asks first: a button on each web row, and on mobile a long press on the row (or its screen-reader action) that opens a system confirm.
- **Cap.** A response at PostgREST's 1,000-row `max_rows` is treated as truncated, and a status line above the list says it is showing only the newest, whether the list shows rows or a search that matched nothing (not above the error or offline states). Backwork hit this cap (#3525); a chapter's documents are far fewer.

The server's `search` parameter has no client caller since #3938; it stays for API consumers and the contract.

## Metadata

Each document has: a system-generated `id` (UUID, primary key — **not** the `{document_id}` in the storage path below: that is a separate UUID minted by the upload-URL step and returned as `documentId`, so no storage path can be derived from a document's `id`), title, description (optional), folder (optional), storage path, uploaded_by (FK users), and created_at. No academic metadata (no department, professor, assignment type, etc.).

Four additional fields, all optional and populated at confirm-upload time: `content_type` (MIME type, client-declared), `byte_size`, `document_type` (free text — no fixed taxonomy, unlike Backwork's checked `assignment_type`), and `effective_date` (the date the document took effect, distinct from `created_at` which is upload time — never inferred, only user-supplied). These exist for the AI corpus retrieval design ([`spec/architecture/README.md`](../architecture/README.md) § 13 AI Corpus Architecture — **not** [ADR-13](../architecture/adr/adr-13.md), which is Repository visibility), which needs a currency signal distinct from upload time and provenance metadata beyond a title.

## Storage

Files are stored in Supabase Storage under `chapters/{chapter_id}/documents/{document_id}/{filename}`. The upload-URL step generates this chapter-scoped path server-side. On confirm, the API rejects any `storage_path` that does not start with `chapters/{chapter_id}/documents/` (the caller's active chapter) so a client cannot register metadata that points outside its own chapter folder, and any whose rest is not the `{document_id}/{filename}` shape the mint builds with `safeObjectFilename` (its kept characters, no trailing space), since a `?`, `#`, `%` or trailing-space spelling of a filed path names the same object under another string (#3399). Confirm is idempotent on the stored object: one row per `storage_path` (`chapter_documents_storage_path_key`), so a confirm retried after its response was lost returns the row it already filed, unchanged, to the member who filed it, and refuses anyone else with a 409 (#3399). Both answers come from a read made before the confirm's folder is registered, so neither leaves an empty folder behind; only two confirms racing past that read can, since the loser registers its folder before the index refuses its row. Two rows on one object would break delete, which removes the object. Because a replay changes nothing, a client retrying a confirm resends the title and folder it first sent; how s21 does that is in [`../ui/mobile/screens.md`](../ui/mobile/screens.md) (s21). Signed download URLs are only issued for documents already scoped to the active chapter.

There is no separate download endpoint: `GET /v1/documents/{id}` returns the document *with* a freshly signed URL, on the key **`downloadUrl`**. No case-transforming interceptor exists anywhere in the stack, so a client that reads `download_url` gets `undefined` — which is exactly what both web call sites did until #1040. Clients resolve it through `selectDownloadUrl` (`packages/hooks/src/document-download.ts`), a deliberately pure module — no `"use client"`, no react-query — so mobile's plain-node selectors and any server component can import it. It accepts either spelling so a server-side rename cannot break a client, and is the only place either spelling appears **for a document or backwork download**. Scope that carefully before any cleanup: `download_url` is the correct, live key for **chat attachments** — a different endpoint, which emits it at `chat-attachment.service.ts` and declares it on `ChatMessageAttachmentWithUrl`, the subtype that adds the key — so converging those onto `downloadUrl`, or routing them through this selector, breaks every attachment link and inline image. Nothing typed enforces any of this: none of these endpoints declares an OpenAPI response schema, so the SDK infers the body as `never` and any property access compiles.

### Two links: inline and saved

`GET /v1/documents/{id}` returns two signed links to the file from one signing call, each good for an hour (#3849):

- **`downloadUrl`** serves the file inline, with no `Content-Disposition`, so a browser shows a PDF or image in place. Mobile's s12 opens it in the in-app browser, and the web viewer (§ Preview) reads the file through it. Whether it should stay inline for every client is [#3867](https://github.com/pdcarlson/Frapp/issues/3867); Backwork's `GET /v1/backwork/{id}` link is inline too.
- **`forcedDownloadUrl`** is the same signed link with a `download` query parameter naming the stored filename (the storage key's last segment), so storage serves it with `Content-Disposition: attachment` and following it saves the file. The parameter sits outside the signature, so anyone holding `downloadUrl` can turn it into a download; nothing is protected by the difference. Web's Download controls follow it (`selectForcedDownloadUrl`), and fall back to opening `downloadUrl` in a new tab when a server predates it.

## Preview

*(Added 2026-11-09, #3849; Shawn's idea, his pick of the full-screen option.)* On web `/documents`, clicking a row's name opens the document full screen, in the viewer chat's images open in (`apps/web/components/shared/media-viewer.tsx`, [chat § File and image uploads](chat/README.md)): a dim backdrop over the whole window, icon-only Download and Close in the top-right corner, step arrows at the sides that walk the list as it is shown (folder, search, filters and sort applied, [§ Search](#search)), wrapping at the ends, and Esc, the backdrop or Close to dismiss. Unlike chat's, it draws the document's title and a meta line (type, upload date, folder) top-left, because a document's title is the one its uploader typed. Stepping keeps one dialog open and swaps the file inside it. Closing returns focus to the row of the document it was showing, which may not be the one that opened it, as chat's viewer returns to the image it was showing.

What previews (`previewKind` in `apps/web/components/documents/document-viewer.tsx`), decided by the declared `content_type`. When no type was recorded, a stored `.pdf` extension still counts as a PDF; nothing else is guessed from a name:

- **PDFs** are drawn page by page with pdf.js in the member's own browser (`apps/web/lib/backwork-bulk/pdf.ts`, the loader Backwork's bulk upload uses), into images in a column that scrolls. The first page is readable while the rest draw; at most 50 pages are drawn, and a longer file says so and offers the download.
- **Images** on chat's viewable list (JPEG, PNG, GIF, WebP, BMP) draw in an `<img>`.
- **Everything else**, Office files, text and CSV included, shows a card naming the type ("Excel spreadsheets can't be previewed yet") with a Download button. Previewing Office files needs a converter or an outside viewer; which one is a privacy decision for the owner, tracked in [#3889](https://github.com/pdcarlson/Frapp/issues/3889).

Neither path loads the member's file as a document, which keeps the trust rule chat states for member uploads: pdf.js parses the bytes and paints a canvas, and an `<img>` decodes or fails. The file is fetched from our own storage only. A load that fails (the link, the bytes, or an image that doesn't decode) says so with Try again, which fetches fresh links first; Download stays in the corner throughout. A file that doesn't preview fetches no links until Download is pressed, and Download reuses the links the viewer already holds while they're fresh.

Mobile is unchanged: s12 still opens `downloadUrl` in the in-app browser.

## Upload allowlist

Chapter documents share the `document` kind in `@repo/validation` (`packages/validation/src/upload-allowlists.ts`) with Backwork and chat attachments. That single list is what the API, the web Documents page, mobile's upload sheet (s21), the Backwork page, the chat composer, and the `documents` / `backwork` / `chat` buckets must agree on. The membership of that list, the `MAX_UPLOAD_BYTES` cap, the never-SVG rule, and why `image/gif` and legacy `.doc` / `.xls` / `.ppt` are on it are owned by [`docs/security/content-validation.md`](../../docs/security/content-validation.md) § Validations Required — do not restate them here.

Clients check type and size via `inspectUploadFile` before requesting a signed URL. `POST /v1/documents/upload-url` also accepts an optional `size_bytes`, checked with `isWithinUploadSizeLimit` before the URL is issued; because that field is optional and client-declared, the bucket `file_size_limit` stays the only server-side size gate.

## Edge Cases

- Deleting a folder moves its documents to the root level (no cascading delete of files). The documents move first, so a failure part-way leaves the folder intact rather than stranding documents under a name that no longer exists.
- Document titles do not need to be unique. Duplicate file content (same hash) is allowed since organizational documents may be legitimately duplicated (e.g. updated versions).
