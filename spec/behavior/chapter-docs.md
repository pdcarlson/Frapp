# Chapter Documents

A "Chapter Files" storage area for organizational documents (bylaws, constitutions, meeting agendas, etc.), separate from Backwork which is strictly for academic materials.

## Permissions

- `chapter_docs:upload` — Upload new documents.
- `chapter_docs:manage` — Delete documents, create/rename/delete folders.
- All members can view and download documents regardless of permissions.

## Structure

- Documents are organized into an optional flat folder structure (one level deep). A document belongs to zero or one folder.
- Folders have a name and a sort order. Documents without a folder appear in a root "All Files" view.
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

## Metadata

Each document has: a system-generated `id` (UUID, primary key — this is the `{document_id}` referenced in the storage path below), title, description (optional), folder (optional), storage path, uploaded_by (FK users), and created_at. No academic metadata (no department, professor, assignment type, etc.).

## Storage

Files are stored in Supabase Storage under `chapters/{chapter_id}/documents/{document_id}/{filename}`. The upload-URL step generates this chapter-scoped path server-side. On confirm, the API rejects any `storage_path` that does not start with `chapters/{chapter_id}/documents/` (the caller's active chapter) so a client cannot register metadata that points outside its own chapter folder. Signed download URLs are only issued for documents already scoped to the active chapter.

There is no separate download endpoint: `GET /v1/documents/{id}` returns the document *with* a freshly signed URL, on the key **`downloadUrl`**. No case-transforming interceptor exists anywhere in the stack, so a client that reads `download_url` gets `undefined` — which is exactly what both web call sites did until #1040. Clients resolve it through `selectDownloadUrl` in `@repo/hooks`, which sits beside the `useDocument` query that returns the payload, accepts either spelling so a server-side rename cannot break a client, and is the only place either spelling appears. Nothing typed enforces this: the endpoint carries no OpenAPI response schema, so the SDK infers the body as `never` and any property access compiles.

## Upload allowlist

Chapter documents share the `document` kind in `@repo/validation` (`packages/validation/src/upload-allowlists.ts`) with Backwork and chat attachments. That single list is what the API, the web Documents page, the Backwork page, the chat composer, and the `documents` / `backwork` / `chat` buckets must agree on.

Allowed: JPEG, PNG, GIF, WebP, PDF, Open XML Office (`.docx` / `.xlsx` / `.pptx`), **legacy Office** (`.doc` / `.xls` / `.ppt`), plain text, and CSV. Size cap: 25 MB (`MAX_UPLOAD_BYTES`). SVG and executables are rejected.

GIF belongs on this list. A private copy on the Backwork page previously omitted it while Documents, the Backwork API service, and the `backwork` bucket all accepted `image/gif` — the client refused the file before the API was called.

Legacy `.doc` / `.xls` / `.ppt` stay allowed. The API and buckets already accepted them; the web clients had omitted them from `accept`/maps. Completing the client is the decision — dropping them server-side would reject files the buckets still store.

Clients check type and size via `inspectUploadFile` before requesting a signed URL. The signed-URL request does not carry a byte length; the bucket `file_size_limit` remains the server-side size gate.

## Edge Cases

- Deleting a folder moves its documents to the root level (no cascading delete of files). The documents move first, so a failure part-way leaves the folder intact rather than stranding documents under a name that no longer exists.
- Document titles do not need to be unique. Duplicate file content (same hash) is allowed since organizational documents may be legitimately duplicated (e.g. updated versions).
