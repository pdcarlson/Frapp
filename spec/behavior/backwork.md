# Backwork (Academic Library)

## Rich Metadata

Every uploaded resource carries the following metadata fields. **All fields except the file and its hash are optional** to allow graceful handling of incomplete information.

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
- Auto-vivification is **not** transactional: `confirmUpload` resolves-or-creates the department, then the professor, then inserts the resource as three independent writes. A failed resource insert leaves the new department and professor rows behind, which the next upload reuses rather than duplicating.
- Department records store the short code (e.g. "CS") and an optional full name (e.g. "Computer Science") that admins can fill in later.
- Filling in that name (`PATCH /v1/backwork/departments/:id`, requires `backwork:admin`) is scoped to the caller's active chapter: a department ID belonging to another chapter matches no row and returns **404 Not Found** instead of being renamed.

## Taxonomy Admin

Uploads accumulate junk departments and professors — typos, duplicate spellings, one-off OCR misreads — that manual admin cleanup fixes. `backwork:admin` gets rename, delete, and merge for both, mirroring each other: `PATCH /v1/backwork/{departments,professors}/:id` (rename), `DELETE /v1/backwork/{departments,professors}/:id`, `POST /v1/backwork/{departments,professors}/:id/merge`.

- **Delete blocks rather than orphaning.** `department_id`/`professor_id` on `backwork_resources` are `on delete set null`, so a bare delete would silently blank the field on every resource still tagged with it. The API instead counts referencing resources first and returns **400** naming the count when it's nonzero — merge is the guided path to clear that.
- **Merge reassigns then deletes.** `POST .../:id/merge` with `{ target_id }` moves every resource tagged with the source to the target, then deletes the source, returning `{ reassigned: <count> }`. Not wrapped in a database transaction: the only failure window is a resource created between the reassign and the delete, which the same `on delete set null` FK degrades to a blank field on that one row rather than an orphaned reference — self-healing on the next re-tag, unlike the ledger-touching operations elsewhere in this codebase that do need an atomic RPC.
- Both operations 404 when the source or target id belongs to another chapter, and 400 when merging an entry into itself.
- Rename, delete, and merge all require `backwork:admin`. Browsing needs either `backwork:upload` or `backwork:admin` (the controller's class-level any-of gate); uploading needs `backwork:upload` specifically, so `backwork:admin` alone does not grant it.
- The web dashboard's "Manage taxonomy" drawer (`apps/web/components/backwork/backwork-taxonomy-drawer.tsx`) surfaces all three actions per department/professor.

## Duplicate Prevention

Unique constraint on (chapter_id, file_hash). If the exact same file (by hash) has already been uploaded to the chapter, the API returns 409 Conflict with a reference to the existing resource.

A flattened file is hashed as uploaded, after flattening (§ PDF Redaction). The PDF assembly adds nothing that varies (no timestamps or IDs), but the page images come from the browser's renderer and JPEG encoder, which differ between browsers and devices. So the same PDF flattened twice on the same browser is usually caught; the same PDF flattened on two different browsers, or boxed differently, is a different file and is not, and a flattened copy never matches an earlier as-is upload of the same original. Bulk upload also skips a file already in the same batch, by the original's hash.

## Storage

Files are stored in Supabase Storage under `chapters/{chapter_id}/backwork/{resource_id}/{filename}`. The upload-URL step generates this chapter-scoped path server-side. On confirm, the API rejects any `storage_path` that does not start with `chapters/{chapter_id}/backwork/` (the caller's active chapter) so a client cannot register metadata that points outside its own chapter folder. Signed download URLs are only issued for resources already scoped to the active chapter.

As with chapter documents, the signed URL comes back on `GET /v1/backwork/{id}` under the key **`downloadUrl`**, and clients read it through `selectDownloadUrl` in `@repo/hooks` rather than naming a spelling at the call site — see [`chapter-docs.md`](./chapter-docs.md) § Storage for why (#1040).

Backwork's size ceiling is its own: **50 MB per file** (`MAX_BACKWORK_UPLOAD_BYTES`), above the 25 MB every other member upload keeps, because scanned exams run large (#3487). The `backwork` bucket's `file_size_limit` mirrors it.

The file-type allowlist is the `document` kind in `@repo/validation`, shared with chapter documents and chat — including `image/gif` and legacy Office (`.doc` / `.xls` / `.ppt`). Membership and the rationale: [`content-validation.md`](../../docs/security/content-validation.md) § Validations Required.

## Browsing and Search

- Resources are browsable by department, course, professor, semester/year, assignment type, and tags.
- Full-text search across title, tags, course name, and professor name. **Built, it matches `title` and `course_number` only**: the library (`GET /v1/backwork?search=`) still runs a case-insensitive substring match (#1357), and global search's Backwork vector indexes the same two columns ([`search.md` § Global search](search.md#global-search) records why). Widening it to tags, department and professor is #585.
- Results are always scoped to the user's active chapter.
- **Dashboard `/backwork`:** `useBackworkResources` is `enabled: !!chapterId`. With no chapter selected the page shows "No chapter selected", never a spinner. The resource list gates its spinner on `isLoading` or `fetchStatus === "paused"` (offline, no data); a disabled TanStack Query v5 stays `isPending` with `fetchStatus: "idle"` and must not be treated as in-flight or as an empty library.

## PDF Redaction

Redaction ships with web bulk upload (`/backwork/upload`, #3499). PDFs only; the single-file upload sheet on `/backwork` still uploads as-is.

1. The person drops PDFs, or folders of PDFs, and works through them one at a time. The next two documents load in the background while they work on the current one, and finished ones flatten and upload behind them, so moving to the next document never waits. The batch lasts as long as the browser tab: leaving the page doesn't cancel what was already submitted, it keeps uploading, and coming back to Bulk upload shows the same list, so a failure (shown as a toast while the page is closed) can be retried from its row without redacting again. While anything in the batch isn't uploaded yet, the browser asks before the tab closes or reloads. A batch belongs to one account and one chapter. A chapter switch, a sign-out, or another account signing in ends it: nothing more from it is uploaded or shown, so it is never filed in the wrong chapter or under, or seen by, the next account. The chapter switcher and Sign out ask first when that would drop documents not uploaded yet.
2. The editor renders each page. The person drags opaque black boxes over a name, student ID, or handwriting, and can move, resize, delete, undo, or copy one page's boxes to every page.
3. A person reviews every document before it uploads. Nothing is submitted without them.
4. A **Student Copy is always flattened**, and so is any document with a box on it. Flattening happens on the person's device: each page is rendered to an image with the boxes burned in, and a new PDF is built from those images, with no metadata and no form fields. Only the flattened file is uploaded; the original's bytes never leave the browser, and the stored file is named after the confirmed title rather than the original filename (which for a Student Copy is often the student's name). The title starts as the filename, so the person checks it. A Blank Copy or Answer Key with no boxes uploads as the original file.
5. Text outside the boxes is kept as an invisible, searchable layer over the image. Any text item that touches a box (within 2 points) is dropped whole, so a box that clips part of a name drops the whole name. Text the rendered page doesn't show is dropped too: before the boxes go on, the middle of each text item's area is checked for ink, so text under an earlier tool's black bar or a covering image, white-on-white text, and text off the page never reach the layer. Rotated text and text on rotated pages is filtered the same way but not redrawn.
6. The storage record is flagged `is_redacted: true` whenever the file was flattened.

**Rationale:** Overlaying black boxes on an existing PDF does not prevent text selection of the underlying content. Rendering to images ensures true redaction; the rebuilt text layer comes only from text the boxes don't touch, so search keeps working without carrying a redacted word.

**Limits:** The ink check looks for contrast, so hidden text over a busy background (a photo, a pattern) still reads as visible and is kept; it is only as hidden as the page made it. Very faint visible text (a light watermark) can read as invisible and drop out of search. A scanned page has no text to keep, so it stays image-only.

## AI Metadata Extraction (Phase: v3+)

On upload, an optional AI step parses the PDF and pre-fills metadata fields (department, course number, professor, assignment type, etc.). The user reviews and corrects before confirming. The data model and upload flow must not block this future capability (all metadata fields are optional; the upload endpoint accepts partial metadata).

## Chat Integration

Backwork has no slash command and no rich renderer, by design: nothing it produces belongs in a message ([`integrations.md` § Integration Pattern](integrations.md#integration-pattern), #2468).
