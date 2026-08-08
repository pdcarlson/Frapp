# Reports and Export

Admins with `reports:export` permission can generate and download reports from the web dashboard.

## Available Reports

| Report            | Scope                                                                     | Columns                                                                                     |
| ----------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| **Attendance**    | Per event or date range                                                   | Member name, event name, date, status (PRESENT/ABSENT/EXCUSED/LATE), check-in time          |
| **Points**        | Per member or chapter-wide; optional time window (all / semester / month) | Member name, total points, breakdown by category (ATTENDANCE, SERVICE, STUDY, MANUAL, FINE) |
| **Member roster** | Current members                                                           | Name, email, role(s), join date, point balance                                              |
| **Service hours** | Per member or chapter-wide                                                | Member name, date, duration, description, status (APPROVED/PENDING/REJECTED)                |

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

| `format`         | Response                                                                                                                                            |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `json` (default) | The report rows, for on-screen preview.                                                                                                             |
| `csv`            | An inline `text/csv` body with a `Content-Disposition` attachment header.                                                                           |
| `pdf`            | A JSON envelope — `{ url, expires_at, expires_in, filename, storage_path, row_count }` — whose `url` is a **signed download URL valid for 1 hour**. |

Only PDF takes the signed-URL path. Rendering a PDF is server-side work that
produces a stored artifact, so the document is written to the private `reports`
bucket under `chapters/{chapter_id}/reports/` and handed back as a time-limited
link rather than streamed inline. CSV needs no such artifact and stays a direct
body. The bucket carries no storage RLS policies: it is written only by the API's
service-role client and read only through the URLs the API signs, so a generated
export is never publicly addressable and never reachable across chapters.

The dashboard additionally builds a CSV client-side from the previewed rows, which
is why its "Download CSV" button issues no second request.

Column identity, order, and labels are shared between the CSV and PDF exports.
Individual cell values are rendered for their audience: CSV emits composite
values as JSON so a spreadsheet import stays parseable, the PDF flattens them
for reading (`ATTENDANCE: 12, SERVICE: 4`).

### Retention

**Generated PDFs are deleted 24 hours after they are written.** The signed URL
expires after an hour, so anything past that is already unreachable through the
API; the extra day covers a stalled download or a retried request without
keeping the artifact around longer than it is useful. An hourly sweep removes
expired objects, so an export is reaped within an hour of turning 24h old.

Reports are **derived artifacts** — every one is regenerable from the source
tables it was rendered from, and nothing in the database references the stored
object — so deleting one never affects live data. Re-running the export
produces a new object with a new random key.

Roster exports carry member names, emails, roles, and join dates, which puts
this storage in scope for [`data-retention.md`](data-retention.md). Account
deletion therefore does **not** wait for the retention window: it clears the
report prefix of every chapter the departing member belonged to, immediately
and before the database scrub. A rendered PDF cannot have one member removed
from it, so dropping the chapter's exports is the only complete erasure —
officers simply re-export.

## PDF Formatting

PDF reports use a clean, branded template with:

- Chapter name, university, and logo (if uploaded) in the header.
- Frapp branding and a page counter in the footer.
- Report title and a scope line naming the date range and any member/event filter.
- Tabular data with alternating row shading for readability, paginated across
  landscape US Letter pages.

A logo that is missing, or not a readable PNG/JPEG, is skipped with a warning
rather than failing the export.

### Text degradation

The document is rendered with the standard PDF fonts, which cover Latin-1 only,
so text outside that range is folded. The governing rules, in order:

- Characters Latin-1 can represent pass through unchanged — `José` keeps its accent.
- Modified Latin letters fold to their base: `ā` → `a`, `Ł` → `L`, `Đ` → `D`.
- **Zero-width characters vanish rather than degrading.** Combining marks with no
  precomposed form, format characters (a UTF-8 BOM surviving a roster import, a
  zero-width space, a bidi mark), and the soft hyphen are dropped — a character
  that was invisible must never become visible.
- Line and paragraph separators, and exotic spaces, collapse to a single space,
  as newlines and tabs do. Every cell is one line.
- Vulgar fractions expand rather than losing a digit: `1⅓ hrs` renders
  `1 1/3 hrs`, never `113 hrs`. A fold must never fabricate a different value.
- Anything left with no encodable form becomes a single `?` per source
  character — a member name in a non-Latin script is degraded, never a failed
  export, and never inflated into a run of question marks.

### Row limits

Report queries are not paged, so they are capped by PostgREST's `max_rows`
(1000, `supabase/config.toml`). A report matching more rows than that is
**silently short in every format**, PDF included — the document's page counter
and the response's `row_count` describe what was returned, not what matched.
Tracked in FRA-342; do not treat an exported report as a complete record of a
chapter larger than the cap until it is fixed.

### Unsupported formats

An unrecognized `format` is rejected with `400`, matching the points `window`
rule above, rather than silently falling back to `json`. Omitting `format`
selects `json`.

## Chat Integration

Chat integration (slash commands, rich renderers, system channel): see [`integrations.md`](integrations.md).
