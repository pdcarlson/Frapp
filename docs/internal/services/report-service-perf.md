# Report Service Performance

## Paging and the row ceiling

Every report read pages through PostgREST's `max_rows` (1000,
`supabase/config.toml`) in 1000-row requests, up to `REPORT_MAX_ROWS` (20,000).
Before paging, each query simply stopped at 1000 and said nothing.

The ceiling is deliberate. A report is assembled and rendered synchronously in
the API process, and the PDF path is the expensive half: 40,000 rows were
measured at 5.3 MB and ~7.7 s of mostly-synchronous pdf-lib work. Unbounded
paging would replace a silent-truncation bug with a request timeout.

Measured against the local stack (Supabase CLI 2.110.0 / PG17), reading a
20,000-row service report — 21 round-trips — costs about **0.5 s and ~10 MB of
heap** before any rendering. Doubling the ceiling roughly doubles both, and
adds the pdf-lib cost on top, which is what makes 20,000 the practical bound.

Two consequences worth remembering when editing these queries:

- **Paged reads need a total order.** Every one sorts on the table's `id`.
  Offset paging over a non-unique sort key has no guaranteed order between
  statements, so rows sharing a sort value across a page boundary can be
  returned twice or skipped. `getServiceReport` sorts `date desc, id asc` for
  exactly this reason. The one read that cannot do this is the points RPC,
  which exposes no key — tracked in #747.
- **`in (...)` lists are chunked at 100 IDs.** Measured on the same stack, 200
  UUIDs (~7.5 KB of URL) is the last size that succeeds; 250 (~9.3 KB) returns
  `414 URI Too Long`. Unchunked, the roster's member lookup failed outright for
  chapters past roughly 220 members.

## getRosterReport

The `getRosterReport` method fetches a list of members, and then needs to retrieve details about those users and their point transactions.

To minimize latency for large chapters, the queries for `users` and `point_transactions` are parallelized using `Promise.all()`. They depend on the result of the `members` query, but are independent of each other. This reduces the number of sequential network roundtrips required to build the roster report.

Point transactions read under a separate, higher ceiling
(`REPORT_AGGREGATE_MAX_ROWS`, 200,000) because those rows are summed into a
balance and never reach the document — the bound there is about memory, not
render cost. A truncated transaction read does not shorten the roster; it
leaves every balance on it wrong, so it still marks the report truncated.
