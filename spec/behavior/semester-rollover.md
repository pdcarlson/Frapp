# Semester Rollover

Admins with `semester:rollover` permission can trigger a "New Semester" action from chapter settings.

## On Rollover

1. The current leaderboard period is archived with a label (e.g. "Fall 2025") and a date range. This is stored in a `semester_archives` table.
2. A new leaderboard period begins. Points continue to accumulate in `point_transactions` (no data is deleted), but the leaderboard view defaults to the new period. Historical periods remain selectable in a dropdown.
3. Admins are prompted with an option to bulk-transition members from the "New Member" role to the "Member" role (pledge promotion). This is optional and can be done individually as well.
4. Study session configurations (geofences, reward rates, minimum session lengths) carry forward unless manually changed.

## Historical Data

- All historical semesters are viewable in the leaderboard, reports, and attendance views via a semester/period selector.
- Point transactions, attendance records, and service entries are timestamped and can always be filtered by date range regardless of semester archives.

## Edge Cases

- A chapter may trigger a rollover at most once per **named calendar month** — e.g. a rollover on January 15 blocks another until February 1, regardless of how many days have elapsed. Attempting a second rollover within the same calendar month returns `409 Conflict`.
- If no semester archive exists yet (brand new chapter), the leaderboard shows "All Time" as the default period.
