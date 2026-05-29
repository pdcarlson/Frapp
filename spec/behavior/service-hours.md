# Service Hours (Philanthropy / Community Service)

A dedicated tracker for community service and philanthropy hours, separate from study hours.

## Logging

- Members with the `service:log` permission log service entries: date, duration (hours and minutes, stored as `duration_minutes`), description (what they did), and optional proof (file upload — photo, PDF, etc.).
- Proof files are stored in Supabase Storage under `chapters/{chapter_id}/service/{entry_id}/`.
- All entries are chapter-scoped.

## Approval Workflow

- New entries start with status PENDING.
- Admins with `service:approve` permission review entries and mark them APPROVED or REJECTED with an optional comment.
- **On approval:** A point transaction is automatically created (category: SERVICE) based on a chapter-configurable rate (e.g. 1 point per 60 minutes of service). The system tracks whether points have been awarded for an entry and prevents double-awarding on repeated approval actions.
- **On rejection:** No points are awarded. The member is notified with the admin's comment.
- Admins can view all PENDING entries in a dedicated queue on the web dashboard.

## Visibility

- Members see their own service history (all statuses) and a chapter-wide service leaderboard (total approved hours).
- Admins see all entries for all members with filtering by status, date range, and member.

## Edge Cases

- If an admin accidentally approves an entry, they can change the status back to REJECTED. If points were already awarded, a separate point adjustment is required (the system does not auto-reverse).
- Service entries cannot be edited after submission. If the member made an error, they delete the entry and resubmit (only possible while status is PENDING).
