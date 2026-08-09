# Service Hours (Philanthropy / Community Service)

A dedicated tracker for community service and philanthropy hours, separate from study hours.

## Logging

- Members with the `service:log` permission log service entries: date, duration (hours and minutes, stored as `duration_minutes`), description (what they did), and proof (file upload — photo, PDF, etc.). Proof is **required at submission when the chapter's `wf_hours_receipt` workflow is enabled** (the seed default — see the runtime-enforcement rules in [`settings/customization.md`](settings/customization.md)) and optional otherwise.
- Proof files are stored in the private `service` Supabase Storage bucket under `chapters/{chapter_id}/service/{proof_id}/` — a server-minted prefix bound to the active chapter (the proof id is generated before the entry exists, since proof is uploaded first and attached at submission).
- Proof uses the same signed-URL flow as Backwork and chapter documents, plus a storage existence check at submission: the client requests an upload URL (`POST /service-entries/proof-upload-url`; images and PDF only, 25MB max), uploads to it, then submits the returned storage path as `proof_path`. The API rejects entries whose `proof_path` falls outside the active chapter's service-proof prefix or does not reference an actually-uploaded object — a member can never attach an arbitrary, guessed, or cross-chapter storage key. The type and size limits are enforced on the bucket itself (`allowed_mime_types` / `file_size_limit`), because a signed upload URL cannot pin a content type — the API allowlist alone would only gate URL issuance.
- Proof is read through `GET /service-entries/{entry_id}/proof-url` (entry owner or `service:approve` admins), which returns a short-lived signed download URL. Proof objects are never publicly readable and never served across chapters; legacy `proof_path` values that predate validation (free text, external URLs) are not signable.
- All entries are chapter-scoped.

## Approval Workflow

- New entries start with status PENDING.
- Admins with `service:approve` permission review entries and mark them APPROVED or REJECTED with an optional comment.
- **On approval:** A point transaction is automatically created (category: SERVICE) based on a chapter-configurable rate — `chapter_service_config.minutes_per_point`, default **60** (1 point per hour), surfaced as the `service` block on `GET /chapters/:id/config` and written via `PATCH /chapters/:id/config` (`service: { minutes_per_point }`) like every other settings save. A chapter with no row uses the default, so an unconfigured chapter behaves exactly as it did before the rate was configurable. The rate is read **at approval time**, not at submission, so raising it mid-review applies to everything still in the queue. The status flip to APPROVED and the SERVICE ledger insert happen in a **single database transaction** (a compare-and-set on the PENDING / `points_awarded` state), so they commit or roll back together: a partial failure can never award points while leaving the entry PENDING, and concurrent or retried approvals can never double-award — only one caller wins, the rest are no-ops. (Sub-rate durations approve with no ledger row.) See *Atomic Point Awarding* in [`points.md`](points.md).
- **On rejection:** No points are awarded. The member is notified with the admin's comment.
- Admins can view all PENDING entries in a dedicated queue on the web dashboard.

## Visibility

- Members see their own service history (all statuses) and a chapter-wide service leaderboard (total approved hours).
- The leaderboard is `GET /service-entries/leaderboard` (`members:view`), ranking members by total **APPROVED** minutes descending, tie-broken by display name. Pending and rejected time is never ranked. Optional `start_date` / `end_date` filter on the service date and are **inclusive on both ends**; omitting both gives all-time. Aggregation runs in Postgres (`get_service_leaderboard`), not by loading the chapter's entries into the API.
- Admins see all entries for all members with filtering by status, date range, and member: `GET /service-entries` accepts `status`, `start_date`, `end_date`, and `userId`. Filters are applied in SQL, backed by `idx_service_entries_chapter_status_date`. A member without `service:approve` is pinned to their own entries — `userId` cannot widen that read, it can only be ignored — so the same endpoint serves both audiences safely. An inverted or unparseable date range is a 400 rather than a silent empty result.

## Edge Cases

- If an admin accidentally approves an entry, they can change the status back to REJECTED. If points were already awarded, a separate point adjustment is required (the system does not auto-reverse).
- Service entries cannot be edited after submission. If the member made an error, they delete the entry and resubmit (only possible while status is PENDING). Deleting an entry also deletes its proof object from storage, so abandoned proofs never accumulate in the bucket.
