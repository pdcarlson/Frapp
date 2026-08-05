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
2. API generates the report at the requested `format`.
3. Admin downloads the result.

The `format` query parameter on each `POST /v1/reports/*` route selects how step 2
answers:

| `format` | Response |
| --- | --- |
| `json` (default) | The report rows, for on-screen preview. |
| `csv` | An inline `text/csv` body with a `Content-Disposition` attachment header. |
| `pdf` | A JSON envelope — `{ url, expires_at, expires_in, filename, storage_path, row_count }` — whose `url` is a **signed download URL valid for 1 hour**. |

Only PDF takes the signed-URL path. Rendering a PDF is server-side work that
produces a stored artifact, so the document is written to the private `reports`
bucket under `chapters/{chapter_id}/reports/` and handed back as a time-limited
link rather than streamed inline. CSV needs no such artifact and stays a direct
body. The bucket carries no storage RLS policies: it is written only by the API's
service-role client and read only through the URLs the API signs, so a generated
export is never publicly addressable and never reachable across chapters.

The dashboard additionally builds a CSV client-side from the previewed rows, which
is why its "Download CSV" button issues no second request.

## PDF Formatting

PDF reports use a clean, branded template with:

- Chapter name, university, and logo (if uploaded) in the header.
- Frapp branding and a page counter in the footer.
- Report title and a scope line naming the date range and any member/event filter.
- Tabular data with alternating row shading for readability, paginated across
  landscape US Letter pages.

The document is rendered with the standard PDF fonts, which cover Latin-1. Text
outside that range is folded to its nearest encodable form (`ā` → `a`) and
anything with no such form becomes `?` — a member name in a non-Latin script is
degraded, never a failed export. A logo that is missing or not a readable
PNG/JPEG is skipped with a warning for the same reason.

## Chat Integration

Chat integration (slash commands, rich renderers, system channel): see [`integrations.md`](integrations.md).
