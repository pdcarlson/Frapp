# Backwork (Academic Library)

## Rich Metadata

Every uploaded resource carries the following metadata fields. **All fields except the file itself are optional** to allow graceful handling of incomplete information.

| Field                 | Type               | Description                                                                         |
| --------------------- | ------------------ | ----------------------------------------------------------------------------------- |
| **Department**        | Free text          | e.g. "CS", "MATH", "ECON". Auto-vivified per chapter.                               |
| **Course number**     | Free text          | e.g. "101", "3320". Combined with department for display (e.g. "CS 101").           |
| **Professor name**    | Free text          | Auto-vivified per chapter.                                                          |
| **Year**              | Integer            | e.g. 2025.                                                                          |
| **Semester**          | Enum               | Spring, Summer, Fall, Winter.                                                       |
| **Assignment type**   | Enum               | Exam, Midterm, Final Exam, Quiz, Homework, Lab, Project, Study Guide, Notes, Other. |
| **Assignment number** | Integer (optional) | For "Homework 3", "Lab 2", "Exam 1", etc.                                           |
| **Document variant**  | Enum               | Student Copy, Blank Copy (professor-released), Answer Key.                          |
| **Tags**              | Text array         | Free-form for additional categorization.                                            |
| **File hash**         | String             | SHA-256 of the uploaded file. Used for duplicate detection.                         |

## Auto-Vivification

When a member provides a department or professor name that does not exist in the chapter's dictionary, the system automatically creates the corresponding record.

- Lookup is scoped to the chapter. "CS" in Chapter A is independent of "CS" in Chapter B.
- Auto-vivification is atomic with the resource creation (same transaction).
- Department records store the short code (e.g. "CS") and an optional full name (e.g. "Computer Science") that admins can fill in later.
- Filling in that name (`PATCH /v1/backwork/departments/:id`, requires `backwork:admin`) is scoped to the caller's active chapter: a department ID belonging to another chapter matches no row and returns **404 Not Found** instead of being renamed.

## Taxonomy Admin

Uploads accumulate junk departments and professors — typos, duplicate spellings, one-off OCR misreads — that manual admin cleanup fixes. `backwork:admin` gets rename, delete, and merge for both, mirroring each other: `PATCH /v1/backwork/{departments,professors}/:id` (rename), `DELETE /v1/backwork/{departments,professors}/:id`, `POST /v1/backwork/{departments,professors}/:id/merge`.

- **Delete blocks rather than orphaning.** `department_id`/`professor_id` on `backwork_resources` are `on delete set null`, so a bare delete would silently blank the field on every resource still tagged with it. The API instead counts referencing resources first and returns **400** naming the count when it's nonzero — merge is the guided path to clear that.
- **Merge reassigns then deletes.** `POST .../:id/merge` with `{ target_id }` moves every resource tagged with the source to the target, then deletes the source, returning `{ reassigned: <count> }`. Not wrapped in a database transaction: the only failure window is a resource created between the reassign and the delete, which the same `on delete set null` FK degrades to a blank field on that one row rather than an orphaned reference — self-healing on the next re-tag, unlike the ledger-touching operations elsewhere in this codebase that do need an atomic RPC.
- Both operations 404 when the source or target id belongs to another chapter, and 400 when merging an entry into itself.
- Rename, delete, and merge all require `backwork:admin`; browsing and uploading only need `backwork:upload` or `backwork:admin`.
- The web dashboard's "Manage taxonomy" drawer (`apps/web/components/backwork/backwork-taxonomy-drawer.tsx`) surfaces all three actions per department/professor.

## Duplicate Prevention

Unique constraint on (chapter_id, file_hash). If the exact same file (by hash) has already been uploaded to the chapter, the API returns 409 Conflict with a reference to the existing resource.

## Storage

Files are stored in Supabase Storage under `chapters/{chapter_id}/backwork/{resource_id}/{filename}`. The upload-URL step generates this chapter-scoped path server-side. On confirm, the API rejects any `storage_path` that does not start with `chapters/{chapter_id}/backwork/` (the caller's active chapter) so a client cannot register metadata that points outside its own chapter folder. Signed download URLs are only issued for resources already scoped to the active chapter.

As with chapter documents, the signed URL comes back on `GET /v1/backwork/{id}` under the key **`downloadUrl`**, and clients read it through `selectDownloadUrl` in `@repo/hooks` rather than naming a spelling at the call site — see [`chapter-docs.md`](./chapter-docs.md) § Storage for why (#1040).

The file-type allowlist is the `document` kind in `@repo/validation`, shared with chapter documents and chat — including `image/gif` and legacy Office (`.doc` / `.xls` / `.ppt`). See [`chapter-docs.md`](chapter-docs.md) § Upload allowlist.

## Browsing and Search

- Resources are browsable by department, course, professor, semester/year, assignment type, and tags.
- Full-text search across title, tags, course name, and professor name.
- Results are always scoped to the user's active chapter.
- **Dashboard `/backwork`:** `useBackworkResources` is `enabled: !!chapterId`. With no chapter selected the page shows "No chapter selected", never a spinner. The resource list gates its spinner on `isLoading` or `fetchStatus === "paused"` (offline, no data); a disabled TanStack Query v5 stays `isPending` with `fetchStatus: "idle"` and must not be treated as in-flight or as an empty library.

## PDF Redaction (Phase: v2)

When uploading a Student Copy, the user can optionally redact personal information:

1. The in-app viewer renders the PDF page-by-page.
2. The user drags and resizes opaque black rectangles over areas to redact (name, student ID, handwriting, etc.).
3. On confirm, the app **rasterizes** each page to a flat image with the redaction boxes baked in. This is effectively a screenshot — the underlying text and PDF metadata are destroyed.
4. The rasterized version is what gets uploaded and stored. The original PDF is never sent to the server.
5. The storage record is flagged as `is_redacted: true`.

**Rationale:** Overlaying black boxes on an existing PDF does not prevent text selection of the underlying content. Rasterization ensures true redaction.

## AI Metadata Extraction (Phase: v3+)

On upload, an optional AI step parses the PDF and pre-fills metadata fields (department, course number, professor, assignment type, etc.). The user reviews and corrects before confirming. The data model and upload flow must not block this future capability (all metadata fields are optional; the upload endpoint accepts partial metadata).

## Chat Integration

Chat integration (slash commands, rich renderers, system channel): see [`integrations.md`](integrations.md).
