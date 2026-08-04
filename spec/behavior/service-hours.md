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
- **On approval:** A point transaction is automatically created (category: SERVICE) based on a chapter-configurable rate (e.g. 1 point per 60 minutes of service). The status flip to APPROVED and the SERVICE ledger insert happen in a **single database transaction** (a compare-and-set on the PENDING / `points_awarded` state), so they commit or roll back together: a partial failure can never award points while leaving the entry PENDING, and concurrent or retried approvals can never double-award — only one caller wins, the rest are no-ops. (Sub-rate durations approve with no ledger row.) See *Atomic Point Awarding* in [`points.md`](points.md).
- **On rejection:** No points are awarded. The member is notified with the admin's comment.
- Admins can view all PENDING entries in a dedicated queue on the web dashboard.

## Visibility

- Members see their own service history (all statuses) and a chapter-wide service leaderboard (total approved hours).
- Admins see all entries for all members with filtering by status, date range, and member.

## Edge Cases

- If an admin accidentally approves an entry, they can change the status back to REJECTED. If points were already awarded, a separate point adjustment is required (the system does not auto-reverse).
- Service entries cannot be edited after submission. If the member made an error, they delete the entry and resubmit (only possible while status is PENDING). Deleting an entry also deletes its proof object from storage, so abandoned proofs never accumulate in the bucket.
