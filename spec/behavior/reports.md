# Reports and Export

Admins with `reports:export` permission can generate and download reports from the web dashboard.

## Available Reports

| Report            | Scope                      | Columns                                                                                     |
| ----------------- | -------------------------- | ------------------------------------------------------------------------------------------- |
| **Attendance**    | Per event or date range    | Member name, event name, date, status (PRESENT/ABSENT/EXCUSED/LATE), check-in time          |
| **Points**        | Per member or chapter-wide; optional time window (all / semester / month) | Member name, total points, breakdown by category (ATTENDANCE, SERVICE, STUDY, MANUAL, FINE) |
| **Member roster** | Current members            | Name, email, role(s), join date, point balance                                              |
| **Service hours** | Per member or chapter-wide | Member name, date, duration, description, status (APPROVED/PENDING/REJECTED)                |

## Points report time window

The **Points** report accepts an optional `window`, defined identically to the [points leaderboard](points.md#leaderboard):

- `all` (default) — all-time totals.
- `semester` — the active period only: transactions created **after the end of** the most recent semester archive's `end_date` day (see [`semester-rollover.md`](semester-rollover.md)). When no archive exists yet, this is equivalent to all-time.
- `month` — the trailing calendar month.

Totals and per-category breakdowns for a given window **equal the leaderboard** for the same window — the boundary is resolved once and shared, so the two never disagree. An unsupported `window` value is rejected with `400` rather than silently falling back to all-time.

## Export Flow

1. Admin selects report type, scope, and date range on the web dashboard.
2. API generates the file (CSV or PDF).
3. API returns a signed download URL (valid for 1 hour).
4. Admin downloads the file.

## PDF Formatting

PDF reports use a clean, branded template with:

- Chapter name and logo (if uploaded) in the header.
- Frapp branding in the footer.
- Report title and date range.
- Tabular data with alternating row shading for readability.

## Chat Integration

Chat integration (slash commands, rich renderers, system channel): see [`integrations.md`](integrations.md).
