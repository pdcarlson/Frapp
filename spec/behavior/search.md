# Global Search

A single search bar accessible from the top of the mobile and web app:

- Searches across: Backwork resources (title, department, course, professor, tags), chat messages (content), events (name, description), and members (name).
- Results are grouped by domain (Backwork, Chat, Events, Members).
- All results respect chapter scoping and permission checks. Chat-message results are filtered through the same `canAccessChannel` predicate the chat surface uses ([`chat/README.md`](chat/README.md)); vault content is never indexed ([`vault.md`](vault.md#search-indexing)); the member directory requires `members:view`.
- Implementation: Postgres full-text search (`tsvector` / `to_tsquery`) on relevant columns. **All four sources are now on it.** Each matches a `GENERATED ALWAYS ... STORED` tsvector behind a GIN index, queried with `websearch_to_tsquery('english', …)`:

  | Source | Column | Covers | Index | Migration |
  | --- | --- | --- | --- | --- |
  | Chat | `chat_messages.content_search` | `content` | `idx_chat_messages_content_search` | `20260823122000` |
  | Backwork | `backwork_resources.search_vector` | `title`, `course_number` | `idx_backwork_resources_search` | `20260829002000` |
  | Events | `events.search_vector` | `name`, `description` | `idx_events_search` | `20260829002000` |
  | Members | `users.display_name_search` | `display_name` | `idx_users_display_name_search` | `20260829002000` |

  The tsvector's text-search configuration (`english`) and the query's parse configuration must stay in step — a query parsed under a different configuration than the one that built the vector silently under-matches.

  **Backwork covers fewer fields than the list above describes.** `department` and `professor` are FKs to other tables and a `STORED` generated column may only reference its own row, so it cannot join to them; `tags` is same-row but folding it in would *add* matches the previous `ILIKE` never returned. The vector therefore indexes exactly what the service searched before, and widening it is a deliberate behaviour change rather than an indexing one.

  **`users.display_name_search` covers `display_name` alone, deliberately.** `users` also holds `email`, `bio`, `current_city` and `current_company`. `email` in particular must not become searchable by this path — the member source returns rows across the chapter and the directory's own rules, not search's, govern who may see an address. A row-wide `search_vector` on `users` would be a standing invitation to widen that without noticing.

- Member results are one query, not two: `members` with a `users!inner(…)` embed, filtered by `users.display_name_search` and scoped by the outer `chapter_id`. `users` is a **global** table, so that outer `.eq('chapter_id', …)` is the only thing keeping this source chapter-local — the embed filters within the chapter's members rather than searching users at large. It previously loaded the entire chapter roster before filtering.

## Single-channel scope

`GET /v1/search` takes an optional **`channelId`**. It serves the single-channel half of the
chat search contract ([`chat/README.md`](chat/README.md) § Search: *"full-text search within a
single channel or across all channels the user can access"*), which the cross-domain form
alone could not express.

- **Only the `messages` source runs**; `backwork`, `events` and `members` come back empty. The
  response shape is unchanged. A channel-scoped query is definitionally a chat search, so
  running the other three would be work no such caller renders.

  This saving applies to the **single-channel form only**. A chat caller searching chapter-wide
  sends no `channelId` and still pays the full four-source fan-out, exactly as the command
  palette does — there is no source-selection parameter today. Do not read this bullet as
  "chat search is cheap"; it is cheap for the default scope and unchanged for the wide one.
- **The channel is intersected with the caller's accessible-channel set, never trusted.** It is
  the same `accessibleChannelIds` → `canAccessChannel` path the unscoped form uses, so search
  cannot disagree with chat about which role-gated channels a member may read. The id is *also*
  pushed down as a candidate filter on the channel query so a single-channel search does not
  scan every channel row in the chapter — but the intersection is kept as the correctness
  guarantee, deliberately not replaced by it. Narrowing candidates cannot widen the answer;
  relying on the pushed-down filter alone would mean that dropping it silently widens a scoped
  search to every readable channel.
- **An inaccessible or unknown `channelId` returns no matches, not a 403.** Distinguishing the
  two would answer "does this channel id exist?" for a member who cannot read it, making search
  a channel-existence oracle. An empty or whitespace-only value is treated as absent (chapter-wide)
  rather than as a channel that cannot exist.

**This filter cannot be replaced by filtering the response.** The per-source cap is applied by
the database across every channel the caller can read, so a client narrowing a global result to
one channel gets nothing whenever that channel's matches rank below the cut — and cannot tell
that apart from a channel with no matches. Narrowing has to reach SQL.

## MVP defaults

v1 ships with the following defaults. Chapter admins cannot override them; tuning requires a code change. These numbers exist so implementers don't have to guess — revisit with real usage signal before v2.

- **Minimum query length:** 3 characters. Shorter queries return an empty result with an inline hint.
- **Page size:** 20 results per domain per page, 80 results total per page.
- **Per-domain cap:** 50 results. Anything past 50 in a single domain is silently dropped (with a follow-up issue if real usage shows this is too tight).
- **Ranking:** specified as Postgres `ts_rank_cd` over the `tsvector` columns, with per-domain field weighting (e.g. Backwork title outweighs tags) set via `setweight` at index time rather than at query time. **Not implemented for any source, chat included** — `search.service.ts` applies no `ts_rank`, ordering chat by `created_at` and cutting each source at a flat per-domain limit. Migration `20260829002000` records the same gap. Anything that needs relevance scores (hybrid retrieval, rerank) has to add this first.
- **Snippet highlighting:** specified as `ts_headline` on the primary content field, capped at 160 characters per snippet. Not implemented either, per the same migration note.
- **Typo tolerance:** none in v1. Trigram fuzzy match (`pg_trgm`) is a v2 consideration if real usage shows demand. Note this also means **no source** matches **within** a word — `websearch_to_tsquery` matches lexemes, so `attach` finds `attached` (stemming) but `tach` finds nothing. `pg_trgm` is available in the Supabase image but installed nowhere, and enabling it also means registering it in `scripts/check-pglite-migrations.mjs` or the `pglite-migrations` CI job fails.

  This trade is most noticeable on **member names**, because people do type partial names: `Budget` finds `Budgetson`, `udgets` does not. That is the cost of the index and it applies uniformly to all four sources — a source left on `ILIKE` would match differently from the rest, which is worse than the trade itself.
- **Query syntax:** `websearch` parse mode, so quoted phrases, `or`, and a leading `-` for negation all work as a user would expect from a search box — and, unlike `to_tsquery`, stray punctuation never raises a syntax error. A query that reduces to no lexemes at all (a lone stop word) matches nothing.
- **Stopwords:** Postgres default English stopword list.
- **Server-side timeout:** 500 ms budget, applied **per source, not to the search as a whole**. A source that exceeds it contributes an empty array and nothing else changes, so a slow chat-message scan no longer discards member, event and backwork hits that had already come back. `x-search-timeout: 1` is still set when *any* source is short, and `x-search-timeout-sources` names which ones (comma-separated, from `backwork | events | members | messages`) — the difference between "we found nothing" and "we stopped looking here", which the client must render differently.

  This remains an application-level budget (`SearchService.searchWithinBudget`) rather than a Postgres `statement_timeout`, since supabase-js does not cleanly expose per-query `statement_timeout`; it discards a slow result rather than cancelling the query. It should now be rare rather than routine for chat, which is index-backed. A source that *errors* still fails the whole request as a 500 — only slowness degrades.

## Acceptance criteria

- [ ] Cross-chapter results are impossible by construction: every query is parameterized with the caller's active `chapter_id`.
- [ ] Chat-message results pass through `canAccessChannel` before being returned to the client; snippets never include content from inaccessible channels.
- [ ] Vault content never appears in results.
- [ ] Members without `members:view` cannot search the member directory.
- [ ] An adversarial query with 200+ tokens completes within the 500 ms timeout or surfaces the timeout header.
- [ ] A slow source degrades alone: the other three still return their hits, and `x-search-timeout-sources` names the one that was dropped.
- [ ] Every source is index-backed: once a table is large enough for GIN's startup cost to pay off, `explain` shows a Bitmap Index Scan on that source's index. A Seq Scan on a small table is the planner being right, not a missing index — check with `set enable_seqscan = off` before chasing it. Likewise, on a chapter-scoped source the planner may prefer the `chapter_id` btree and apply the tsquery as a filter; that is also correct when the chapter's slice is already small.

  Measured on the local stack at 20,000 events in one chapter with a selective term: the `ILIKE` pair this replaced ran a 20,001-row sequential scan in **35.673 ms**; the tsquery form is a Bitmap Index Scan at **0.071 ms**.
- [ ] Search results carry every column of their source table. The four sources enumerate columns instead of `select('*')` so the generated tsvector is not shipped back per row — which means an added column silently stops appearing in search results, since rows are cast to the entity type rather than inferred. `check-pglite-migrations.mjs` asserts `EVENT_SEARCH_COLUMNS` / `BACKWORK_SEARCH_COLUMNS` equal their table's real columns minus the vector; add a column and that gate fails until the list is updated.
- [ ] Member search issues **one** query and never materialises the roster: a reintroduced `from('users')` fan-out or an `.in(rosterIds)` list is the regression to watch for, and `search.service.spec.ts` asserts both negatives.
- [ ] Imported archive messages are searchable. The archive is in the same table and the same index; the `kind = 'imported'` exclusions elsewhere (unread counts, push, Realtime) deliberately do not apply here — being findable is the point of importing it.
