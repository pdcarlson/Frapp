# Report Service Performance

## Paging and the row ceiling

Every report read pages through PostgREST's `max_rows` (1000,
`supabase/config.toml`) in 1000-row requests, up to `REPORT_MAX_ROWS` (5,000).
Before paging, each query simply stopped at 1000 and said nothing.

**The ceiling is set by rendering, not by reading.** Reading is cheap: a
20,000-row service report costs ~0.5 s and ~10 MB of heap across 21
round-trips. Rendering is not, and it is synchronous — pdf-lib blocks the
event loop, so the cost is paid by every other tenant's requests, not just the
one that asked. Measured on the local stack (Supabase CLI 2.110.0 / PG17)
rendering a service report to PDF:

| rows | render | PDF size | heap |
| --- | --- | --- | --- |
| 1,000 | 0.34 s | 0.13 MB | 16 MB |
| 2,500 | 0.51 s | 0.33 MB | 19 MB |
| 5,000 | 1.08 s | 0.65 MB | 65 MB |
| 10,000 | 2.04 s | 1.30 MB | 28 MB |
| 20,000 | 4.10 s | 2.61 MB | 267 MB |

5,000 keeps the worst-case event-loop stall near a second. Raising it is not a
free knob: 20,000 would freeze the whole API for four seconds and spike a
quarter-gigabyte on a single officer's export. Before paging existed the
renderer never saw more than 1000 rows, so this hazard is one paging
introduced — the ceiling is what keeps it bounded.

Four consequences worth remembering when editing these queries:

- **The page size is a request, not an assumption.** `fetchAllPages` advances
  by however many rows came back and stops only on an *empty* page, so a
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

To minimize latency for large chapters, the queries for `users` and `point_transactions` are parallelized using `Promise.all()`. They depend on the result of the `members` query, but are independent of each other. This reduces the number of sequential network roundtrips required to build the roster report.

Point transactions read under a separate, higher ceiling
(`REPORT_AGGREGATE_MAX_ROWS`, 50,000) because those rows are summed into a
balance and never reach the renderer. That bound is a latency budget rather
than a render cost: the pages are sequential, so 50,000 rows is up to 50
round-trips (~1.2 s) before anything else happens.

A truncated transaction read does not shorten the roster; it leaves every
balance on it wrong. So it marks the report truncated but reports **its own**
ceiling and a note naming the balances — labelling a complete 300-line roster
"capped at 5,000 rows" would read as a false positive and send the reader
looking for missing members instead of distrusting the numbers.

The real fix is to stop streaming transactions into the API and let Postgres
sum them, which removes this read entirely — tracked in #567. It is blocked on
the same missing key as #747: `get_points_report` returns `member_name` and no
`user_id`, and display names are not unique.
