# Global Search

A single search bar accessible from the top of the mobile and web app:

- Searches across: Backwork resources (title, department, course, professor, tags), chat messages (content), events (name, description), and members (name).
- Results are grouped by domain (Backwork, Chat, Events, Members).
- All results respect chapter scoping and permission checks. Chat-message results are filtered through the same `canAccessChannel` predicate the chat surface uses ([`chat/README.md`](chat/README.md)); vault content is never indexed ([`vault.md`](vault.md#search-indexing)); the member directory requires `members:view`.
- Implementation: Postgres full-text search (`tsvector` / `to_tsquery`) on relevant columns.

## MVP defaults

v1 ships with the following defaults. Chapter admins cannot override them; tuning requires a code change. These numbers exist so implementers don't have to guess — revisit with real usage signal before v2.

- **Minimum query length:** 3 characters. Shorter queries return an empty result with an inline hint.
- **Page size:** 20 results per domain per page, 80 results total per page.
- **Per-domain cap:** 50 results. Anything past 50 in a single domain is silently dropped (with a follow-up issue if real usage shows this is too tight).
- **Ranking:** Postgres `ts_rank_cd` over the `tsvector` columns. Per-domain field weighting (e.g. Backwork title outweighs tags) is set via `setweight` at index time, not at query time.
- **Snippet highlighting:** `ts_headline` on the primary content field, capped at 160 characters per snippet.
- **Typo tolerance:** none in v1. Trigram fuzzy match (`pg_trgm`) is a v2 consideration if real usage shows demand.
- **Stopwords:** Postgres default English stopword list.
- **Server-side timeout:** `statement_timeout` of 500 ms per search query. Timeouts surface as an empty result with an `x-search-timeout: 1` response header so clients can distinguish "no matches" from "we gave up."

## Acceptance criteria

- [ ] Cross-chapter results are impossible by construction: every query is parameterized with the caller's active `chapter_id`.
- [ ] Chat-message results pass through `canAccessChannel` before being returned to the client; snippets never include content from inaccessible channels.
- [ ] Vault content never appears in results.
- [ ] Members without `members:view` cannot search the member directory.
- [ ] An adversarial query with 200+ tokens completes within the 500 ms timeout or surfaces the timeout header.
