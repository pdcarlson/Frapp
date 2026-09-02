# Semester Rollover

Admins with `semester:rollover` permission can trigger a "New Semester" action from chapter settings.

## On Rollover

1. The current leaderboard period is archived with a label (e.g. "Fall 2025") and a date range. This is stored in a `semester_archives` table.
2. A new leaderboard period begins. Points continue to accumulate in `point_transactions` (no data is deleted), but the leaderboard view defaults to the new period. Historical periods remain selectable in a dropdown. The active ("this semester") window is defined as point transactions created **after the end of** the most recent archive's `end_date` day, through now — not the archived range. The archived period covers the whole calendar days `[start_date, end_date]` (both stored as `date` values), so any transaction on the `end_date` day belongs to the archived period, not the active one.
3. Admins are prompted with an option to bulk-transition members from the "New Member" role to the "Member" role (pledge promotion). This is optional and can be done individually as well. The prompt is a toggle on the rollover card, **off by default** — it is opted into per rollover, never remembered — and the confirmation dialog restates what it will do before it runs.

   Promotion semantics, since `members.role_ids` is an array rather than a single role:

   - Every member of the chapter holding the New Member role loses it and gains Member. **Members keep every other role they hold** — a New Member who is also Secretary stays Secretary.
   - A member already holding both roles simply loses New Member; Member is not duplicated.
   - Members who never held New Member are untouched, as are members of every other chapter.
   - The archive and the role changes happen in **one transaction** (the `rollover_semester` function). A rollover either archives *and* promotes, or does neither — it can never archive without promoting and then be blocked from retrying by the once-per-month rule.
   - Both roles are resolved by `roles.system_key`, not by name, so a chapter that renamed either role still promotes correctly. If either system role cannot be resolved the rollover is **refused with `409 Conflict`** rather than archiving with a silent no-op promotion; rolling over without promotion still works.
   - Promotion additionally requires **`roles:manage`**, on top of the `semester:rollover` the route already demands. Rewriting `members.role_ids` is what `PATCH /v1/members/:id/roles` gates, and the two permissions are separable — a chapter may grant a custom role `semester:rollover` alone — so requesting promotion without `roles:manage` returns `403 Forbidden`. A rollover *without* promotion needs only `semester:rollover`, and the web toggle is hidden (not merely disabled) for callers who lack `roles:manage`.
4. Study session configurations (geofences, reward rates, minimum session lengths) carry forward unless manually changed.

## Historical Data

- All historical semesters are queryable by `semester_archive_id` — `GET
  /v1/points/{me,leaderboard,members/:userId}` and `POST /v1/reports/points`
  all accept it, resolved against the archive's own `[start_date, end_date]`
  range (see `points.md`). The web Points page exposes this as an "Archived
  period" selector for the leaderboard and balance summary. The Reports page,
  attendance, and mobile do not yet surface a selector for it (#1526).
- Point transactions, attendance records, and service entries are timestamped and can always be filtered by date range regardless of semester archives.

## Edge Cases

- A chapter may trigger a rollover at most once per **named calendar month** — e.g. a rollover on January 15 blocks another until February 1, regardless of how many days have elapsed. Attempting a second rollover within the same calendar month returns `409 Conflict`.
- If no semester archive exists yet (brand new chapter), the leaderboard shows "All Time" as the default period, and the `semester` time window returns all transactions (there is no archived boundary to filter after).
