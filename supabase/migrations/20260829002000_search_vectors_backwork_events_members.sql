-- Indexed full-text search for the three remaining `GET /v1/search` sources.
--
-- WHAT IS THERE TODAY
--
-- `20260823122000_chat_message_search_vector.sql` moved `chat_messages` onto a
-- generated tsvector + GIN. It was the urgent one: the Discord archive import
-- multiplies that table by orders of magnitude. The other three sources were
-- left on `ILIKE '%q%'` and are what this migration finishes (#284):
--
--   backwork_resources  title, course_number   -- .or(title.ilike, course_number.ilike)
--   events              name, description      -- .or(name.ilike, description.ilike)
--   users               display_name           -- .ilike('display_name', ...)
--
-- Every one of those is an unanchored leading-wildcard match, which no btree can
-- serve, so each is a sequential scan today. None is as sharp as chat was, but
-- `events` and `backwork_resources` grow without bound over a chapter's life and
-- `users` is GLOBAL -- it is the one table here whose scan cost is shared across
-- every chapter on the platform, and it grows with total signups rather than
-- with any one chapter. That makes it the most valuable index of the three even
-- though the member source looks like the smallest.
--
-- WHY THESE COLUMNS AND NOT THE SPEC'S WIDER LIST
--
-- `spec/behavior/search.md` describes Backwork search over "title, department,
-- course, professor, tags". `department` and `professor` are FKs to
-- `backwork_departments` / `backwork_professors`, and a STORED generated column
-- may only reference its own row -- it cannot join. `tags` is same-row and could
-- be folded in, but doing so would ADD matches that `ILIKE` never returned,
-- which is a behaviour change rather than an indexing change. This migration
-- deliberately indexes exactly what the service searches today, so the observable
-- result set is unchanged except for stemming (see below). Widening the field set
-- is tracked separately and belongs with the ranking/snippet work the spec's MVP
-- defaults describe (`ts_rank_cd`, `setweight`, `ts_headline`), none of which is
-- implemented for any source yet -- chat included.
--
-- WHY A GENERATED COLUMN AND NOT A TRIGGER
--
-- `to_tsvector(regconfig, text)` is IMMUTABLE (the one-argument form is only
-- STABLE, since it reads `default_text_search_config`), so naming the config
-- explicitly is what makes `generated always as ... stored` legal. Same
-- construction as `chapter_directory.search_vector`
-- (20260523140000_chapter_directory.sql:33-46) and `chat_messages.content_search`
-- (20260823122000). A trigger would be a second place for the definition to drift.
--
-- WHY NO pg_trgm AND NO unaccent
--
-- Unchanged from the chat migration's reasoning: both are available in the
-- Supabase image but installed nowhere, and `scripts/check-pglite-migrations.mjs`
-- registers only `pgcrypto` and `vector` -- an unregistered extension fails that
-- job. tsvector and GIN are core Postgres. Substring matching WITHIN a word
-- ("tach" finding "attached") is what pg_trgm would buy and is a separate
-- decision with its own index cost.
--
-- BEHAVIOUR CHANGE, STATED PLAINLY
--
-- Same trade the chat migration took, now applied to the other three sources:
-- stemming arrives ("meet" finds "meeting"), and mid-word substring matching
-- leaves ("eeti" no longer finds "meeting"). For member names this is the more
-- noticeable of the two, because people do type partial names -- but `websearch`
-- prefix behaviour still covers the common "type the start of a name" case only
-- where the typed fragment is itself a whole lexeme. This is the documented v1
-- trade in `spec/behavior/search.md` § Typo tolerance, applied consistently
-- rather than leaving three sources on a different matching model than chat.
--
-- LOCKS -- THE PART TO READ BEFORE SCHEDULING
--
-- A STORED generated column materialises a value per row, so each `add column`
-- below REWRITES that table's heap under ACCESS EXCLUSIVE, and the GIN build
-- that follows holds SHARE (plain `create index`, not CONCURRENTLY -- Supabase
-- migrations run inside a transaction and CONCURRENTLY cannot). Writes to that
-- table block for the duration.
--
-- Sizes at the time of writing: `events` and `backwork_resources` are small in
-- every environment. `users` is the one to watch, since it is global -- but it
-- is still far below the size where a heap rewrite is disruptive, and it only
-- gets more expensive to do later. That is the argument for landing it now
-- rather than after growth, exactly as the chat index was landed before the
-- archive import rather than after.
--
-- ROLLBACK
--
-- Every object here is additive and independently droppable; nothing reads these
-- columns except `SearchService`, and no application code writes them (a
-- generated column rejects writes by definition). To roll back, revert the
-- service to its `ILIKE` form and then:
--
--   drop index if exists public.idx_backwork_resources_search;
--   drop index if exists public.idx_events_search;
--   drop index if exists public.idx_users_display_name_search;
--   alter table public.backwork_resources drop column if exists search_vector;
--   alter table public.events             drop column if exists search_vector;
--   alter table public.users              drop column if exists display_name_search;
--
-- Dropping the column drops its index, so the index drops are belt-and-braces
-- for a partial-apply. No data is lost by the rollback: every generated value is
-- derived from columns that remain.

-- ---------------------------------------------------------------------------
-- backwork_resources: title + course_number
-- ---------------------------------------------------------------------------
-- `title` and `course_number` are both nullable, hence the coalesce pair.
alter table public.backwork_resources
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(title, '') || ' ' || coalesce(course_number, '')
    )
  ) stored;

-- GIN, not GiST: these rows are written once and searched many times, and GIN's
-- lookups are the faster half of that trade.
create index if not exists idx_backwork_resources_search
  on public.backwork_resources using gin (search_vector);

-- ---------------------------------------------------------------------------
-- events: name + description
-- ---------------------------------------------------------------------------
-- `name` is NOT NULL, `description` is nullable; coalesce both so the expression
-- stays total regardless of later column-nullability changes.
alter table public.events
  add column if not exists search_vector tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' || coalesce(description, '')
    )
  ) stored;

create index if not exists idx_events_search
  on public.events using gin (search_vector);

-- ---------------------------------------------------------------------------
-- users: display_name
-- ---------------------------------------------------------------------------
-- Named `display_name_search` rather than `search_vector` on purpose: this
-- column covers ONE field, not the row. `users` also holds `email`, `bio`,
-- `current_company` and `current_city`, none of which search touches -- and
-- `email` in particular must NOT become searchable by this path, because the
-- member source returns cross-chapter-visible rows and the directory's own
-- rules (not search's) govern who may see an address. A row-wide
-- `search_vector` here would be a standing invitation to widen it later without
-- noticing that.
--
-- `display_name` is NOT NULL DEFAULT '' -- the coalesce is redundant today and
-- kept so the expression survives that default being relaxed.
alter table public.users
  add column if not exists display_name_search tsvector
  generated always as (to_tsvector('english', coalesce(display_name, ''))) stored;

create index if not exists idx_users_display_name_search
  on public.users using gin (display_name_search);
