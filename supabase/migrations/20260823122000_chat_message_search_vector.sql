-- Real full-text search for chat messages.
--
-- WHAT IS THERE TODAY
--
-- `SearchService.searchMessages` runs `.ilike('content', '%q%')` against
-- `chat_messages` with no supporting index -- an unanchored leading-wildcard
-- match, which no btree can serve, so every chapter-wide search sequentially
-- scans the product's largest table. It survives only because the table is small
-- and because a 500ms application-level budget hides the latency by returning
-- nothing. A Discord archive import multiplies the row count by orders of
-- magnitude, at which point "returns nothing" becomes the normal outcome.
--
-- WHY A GENERATED COLUMN AND NOT A TRIGGER
--
-- `to_tsvector(regconfig, text)` is IMMUTABLE (the one-argument
-- `to_tsvector(text)` is only STABLE, because it reads
-- `default_text_search_config`), so naming the configuration explicitly is what
-- makes a `generated always as ... stored` column legal. Same construction as
-- `chapter_directory.search_vector` (20260523140000_chapter_directory.sql:33-46),
-- which is the precedent in this repo. A trigger would be a second place for the
-- definition to drift.
--
-- WHY NO pg_trgm AND NO unaccent
--
-- Both are available in the Supabase image but installed nowhere, and the PGlite
-- CI gate (scripts/check-pglite-migrations.mjs) registers only `pgcrypto` and
-- `vector` -- an unregistered extension fails that job. tsvector and GIN are core
-- Postgres and need neither. Substring/typo matching is a separate decision with
-- a separate cost; this migration buys indexed word search, which is what the
-- ILIKE was approximating.
--
-- LOCKS -- THE PART TO READ BEFORE SCHEDULING
--
-- Unlike a plain `add column` with a non-volatile default, a STORED generated
-- column materialises a value per row, so this REWRITES the heap under ACCESS
-- EXCLUSIVE: chat sends block for the length of the rewrite. The GIN build that
-- follows is a plain `create index` (not CONCURRENTLY -- Supabase migrations run
-- inside a transaction and CONCURRENTLY cannot), which holds SHARE and likewise
-- blocks writes for its duration.
--
-- Both are trivial at today's row count and would not be after an import. Landing
-- the index BEFORE the archive is the entire reason this migration is in the
-- foundation slice rather than in the importer's. Note this supersedes the
-- reasoning in 20260816190000_chat_unread_and_mentions.sql:106-109, which told
-- the next reader that `chat_messages` is deliberately unindexed -- that was
-- specifically about a GIN index on `mentions`, which an aggregate `filter`
-- clause could never use. This one backs a real row-selection predicate.

alter table public.chat_messages
  add column if not exists content_search tsvector
  generated always as (to_tsvector('english', coalesce(content, ''))) stored;

-- GIN, not GiST: the table is read-mostly per row (a message is written once and
-- searched many times) and GIN's lookups are the faster half of that trade.
create index if not exists idx_chat_messages_content_search
  on public.chat_messages using gin (content_search);
