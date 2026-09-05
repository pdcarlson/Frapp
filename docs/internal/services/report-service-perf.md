# Report Service Performance

## Paging and the row ceiling

Every report read pages through PostgREST's `max_rows` (1000,
`supabase/config.toml`) in 1000-row requests, up to `REPORT_MAX_ROWS` (5,000).
Before paging, each query simply stopped at 1000 and said nothing.

**The ceiling is set by rendering, not by reading.** Reading is cheap: at the
5,000-row ceiling a service report is 6 round-trips (five full pages and the
empty one that ends the read) and well under a second; reading 20,000 rows was
measured at ~0.5 s and ~10 MB before the ceiling was lowered, so the read has
never been the binding constraint. Rendering is, and it is synchronous — pdf-lib blocks the
event loop, so the cost is paid by every other tenant's requests, not just the
one that asked. Measured on the local stack (Supabase CLI 2.110.0 / PG17)
rendering a service report to PDF:

| rows   | render | PDF size | heap   |
| ------ | ------ | -------- | ------ |
| 1,000  | 0.34 s | 0.13 MB  | 16 MB  |
| 2,500  | 0.51 s | 0.33 MB  | 19 MB  |
| 5,000  | 1.08 s | 0.65 MB  | 65 MB  |
| 10,000 | 2.04 s | 1.30 MB  | 28 MB  |
| 20,000 | 4.10 s | 2.61 MB  | 267 MB |

Render time is the reliable column and is close to linear (~0.2 ms/row). The
heap column is a single sample taken without a forced collection, so it is
indicative rather than exact — it is non-monotonic between 5,000 and 10,000
because GC happened to run mid-measurement. Treat it as "a few tens of MB up
to 10,000 rows, sharply worse at 20,000", not as a per-row figure.

5,000 keeps the worst-case event-loop stall near a second. Raising it is not a
free knob: 20,000 would freeze the whole API for four seconds and spike a
quarter-gigabyte on a single officer's export. Before paging existed the
renderer never saw more than 1000 rows, so this hazard is one paging
introduced — the ceiling is what keeps it bounded.

Five consequences worth remembering when editing these queries:

- **The points RPC pays for its terminating page.** PostgREST applies
  `LIMIT`/`OFFSET` _outside_ a function call, so the empty page that ends the
  read re-runs `get_points_report` in full — one redundant `GROUP BY` per
  points report, rather than the indexed scan of nothing a table read pays.
  That cost is accepted deliberately: ending on a short page instead would
  make this the one read that silently truncates whenever a server's
  `max_rows` sat below the page size, trading the guarantee this whole change
  exists to provide for a few milliseconds on an infrequent admin action.
- **The page size is a request, not an assumption.** `fetchAllPages` advances
  by however many rows came back and stops only on an _empty_ page, so a
  server whose `max_rows` is lower than `REPORT_PAGE_SIZE` costs extra
  round-trips instead of silently losing rows. This matters because
  `supabase/config.toml` governs the local stack only — the hosted project's
  Max rows is a dashboard setting the code cannot read. The price is one extra
  empty request per report. (`scheduled-jobs.repository.ts` reaches the same
  safety from the other side, by holding its page size below the cap.)
- **Paged reads need a total order.** Every one sorts on the table's `id`,
  which is used for ordering and need not be projected. Offset paging over a
  non-unique sort key has no guaranteed order between statements, so rows
  sharing a sort value across a page boundary can be returned twice or
  skipped. `getServiceReport` sorts `date desc, id asc` for exactly this
  reason. The one read that cannot do this is the points RPC, which exposes no
  key — tracked in #747.
- **A total order is not a snapshot.** The pages are separate statements, so a
  concurrent insert or delete can still shift the window and duplicate or skip
  a row at a boundary. Reports are point-in-time summaries, so this is accepted
  rather than solved; a keyset cursor would be the fix if it stops being.
- **`in (...)` lists are chunked at 100 IDs.** Measured on the same stack, 200
  UUIDs (~7.5 KB of URL) succeeded and 250 (~9.3 KB) returned `414 URI Too
Long` — bracketing the real limit somewhere between, which is why the chunk
  sits well under the lower probe rather than at it. Unchunked, the roster's
  member lookup passed every member ID in one request and failed a large
  chapter's report outright.

## getRosterReport

The `getRosterReport` method fetches a list of members, and then needs to retrieve details about those users and their point transactions.

To minimize latency for large chapters, the queries for `users` and the point
balances are parallelized using `Promise.all()`. They depend on the result of
the `members` query, but are independent of each other. This reduces the number
of sequential network roundtrips required to build the roster report.

**Balances are summed by Postgres (#567).** `get_roster_point_balances`
(`20260905100000`) groups `point_transactions` by `user_id` and returns one row
per member, so the roster no longer streams the ledger into the API to reduce it
here.

That read still pages, under the separate higher ceiling
(`REPORT_AGGREGATE_MAX_ROWS`, 50,000), because an RPC result set is subject to
PostgREST's `max_rows` exactly like a table read. That bound remains a latency
budget rather than a render cost: the pages are sequential, so 50,000 rows is up
to 50 round-trips (~1.2 s) before anything else happens — unchanged by #567,
which altered how many rows it takes to reach that number, not the arithmetic.

But the ceiling now counts **members, not transactions** — reaching it needs a
50,000-member chapter rather than a 50,000-transaction one, which is the
difference between a bound no real chapter approaches and one an active chapter
crossed in a semester. Before this, crossing it meant a roster of the right
length carrying wrong balances.

The aggregate needs no new index: `point_transactions` already carries two
`chapter_id`-leading btrees (`idx_point_transactions_chapter_user` and
`idx_point_transactions_chapter_created_at`), either of which serves the
`where chapter_id = ?` filter. The grouping is a separate cost — the observed
plan sorts by `user_id` before a `GroupAggregate` rather than reading grouped
order out of an index, so "index-backed" describes the filter, not the group.

Do not read a forced plan as a measurement. Checking this on the sandbox
required `enable_seqscan = off` against an empty table, which makes the result
circular: the flag removes the very scan the plan is then said to avoid. On a
small table a sequential scan is the planner being right. The claim worth making
is the structural one — the read now returns one row per member instead of one
per transaction — and that holds regardless of which scan the planner picks.

A short balance read still does not shorten the roster; it leaves balances on it
wrong. So it marks the report truncated but reports **its own** ceiling and a
note naming the balances — labelling a complete 300-line roster "capped at 5,000
rows" would read as a false positive and send the reader looking for missing
members instead of distrusting the numbers.

The RPC returns `user_id`, so the paged read orders on a column that is unique
across the result — a **total** order, with no tie for a page boundary to
duplicate or drop across. This is exactly what `get_points_report` cannot offer:
it returns no key and can only tie-break on display name, which is #747.
