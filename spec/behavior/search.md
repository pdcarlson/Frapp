# Global Search

A single search bar accessible from the top of the mobile and web app:

- Searches across: Backwork resources (title, department, course, professor, tags), chat messages (content), events (name, description), and members (name).
- Results are grouped by domain (Backwork, Chat, Events, Members).
- All results respect chapter scoping and permission checks. Chat-message results are filtered through the same `canAccessChannel` predicate the chat surface uses ([`chat/README.md`](chat/README.md)); vault content is never indexed ([`vault.md`](vault.md#search-indexing)); the member directory requires `members:view`.
- Implementation: Postgres full-text search (`tsvector` / `to_tsquery`) on relevant columns. **Chat messages are the first source actually on it**: `chat_messages.content_search` is a `GENERATED ALWAYS ... STORED` tsvector over `content`, backed by a GIN index, queried with `websearch_to_tsquery('english', …)`. Backwork, events and members still scan with `ILIKE '%q%'` and are unindexed.

## MVP defaults

v1 ships with the following defaults. Chapter admins cannot override them; tuning requires a code change. These numbers exist so implementers don't have to guess — revisit with real usage signal before v2.

- **Minimum query length:** 3 characters. Shorter queries return an empty result with an inline hint.
- **Page size:** 20 results per domain per page, 80 results total per page.
- **Per-domain cap:** 50 results. Anything past 50 in a single domain is silently dropped (with a follow-up issue if real usage shows this is too tight).
- **Ranking:** Postgres `ts_rank_cd` over the `tsvector` columns. Per-domain field weighting (e.g. Backwork title outweighs tags) is set via `setweight` at index time, not at query time.
- **Snippet highlighting:** `ts_headline` on the primary content field, capped at 160 characters per snippet.
- **Typo tolerance:** none in v1. Trigram fuzzy match (`pg_trgm`) is a v2 consideration if real usage shows demand. Note this also means chat search no longer matches **within** a word — `websearch_to_tsquery` matches lexemes, so `attach` finds `attached` (stemming) but `tach` finds nothing. `pg_trgm` is available in the Supabase image but installed nowhere, and enabling it also means registering it in `scripts/check-pglite-migrations.mjs` or the `pglite-migrations` CI job fails.
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
- [ ] Chat-message search is index-backed: once the table is large enough for GIN's startup cost to pay off, `explain` shows a Bitmap Index Scan on `idx_chat_messages_content_search`. A Seq Scan on a small table is the planner being right, not a missing index — check with `set enable_seqscan = off` before chasing it.
- [ ] Imported archive messages are searchable. The archive is in the same table and the same index; the `kind = 'imported'` exclusions elsewhere (unread counts, push, Realtime) deliberately do not apply here — being findable is the point of importing it.
