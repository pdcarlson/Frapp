-- Author fields on chat_messages: a message can now name an author who is not a
-- Signet user (Discord archive import, phase 1 of the migration tool).
--
-- WHY NULLABLE sender_id RATHER THAN SYNTHETIC users ROWS
--
-- The obvious alternative is to mint a `users` row per Discord author and keep
-- `sender_id NOT NULL`. That was rejected. `users` is the identity table the
-- whole product hangs off: a row there is reachable from the chapter roster
-- (`GET /v1/members/roster`), the members directory, server-side mention
-- resolution (`packages/validation/src/mentions.ts` matches on display name, so
-- a Discord handle would become mentionable and pushable), and the blast radius
-- of `anonymize_user`. Minting hundreds of rows to model people who never had
-- accounts pollutes all four to satisfy one FK. A null sender plus a denormalised
-- `author_name` is the smaller lie, and it is the one the read paths can express:
-- names already resolve client-side by id against a cached roster
-- (`packages/hooks/src/display-names.ts`), never by a join, so an unresolvable
-- author was already a case every renderer had to handle.
--
-- The CHECK below is what keeps "nullable" from meaning "anonymous": every row
-- still names its author, through one column or the other.
--
-- Every statement is guarded, so the file is re-runnable (`db push --local` is
-- treated as idempotent -- AGENTS.md § Gotchas).

-- ---------------------------------------------------------------------------
-- 1. Drop the NOT NULL.
--
-- Cheap: a catalog flag, no heap rewrite, ACCESS EXCLUSIVE held momentarily.
-- `alter column ... drop not null` is already a no-op when the column is
-- nullable, so it needs no existence guard.
alter table public.chat_messages
  alter column sender_id drop not null;

-- ---------------------------------------------------------------------------
-- 2. The author columns.
--
-- `author_name`        display name as the export recorded it, at export time.
--                      Denormalised on purpose: there is no row to join to, and
--                      a Discord nickname in 2019 is not a fact that should be
--                      re-derived later.
-- `author_avatar_path` object path in the `chat-archive` bucket, or null. Not a
--                      URL: every bucket in this repo is private and served
--                      through API-issued signed URLs, so storing a URL would
--                      bake in an expiry.
-- `author_external_id` the author's Discord snowflake. Identity, not idempotency
--                      -- see the index note in step 4.
--
-- All three are nullable with no default, so this is catalog-only on a table
-- whose hot path is INSERT: no rewrite, no backfill, no write amplification.
alter table public.chat_messages
  add column if not exists author_name        text,
  add column if not exists author_avatar_path text,
  add column if not exists author_external_id text;

-- ---------------------------------------------------------------------------
-- 3. Every message still names its author.
--
-- Added NOT VALID and validated separately, which is the difference between a
-- momentary ACCESS EXCLUSIVE plus a SHARE UPDATE EXCLUSIVE scan (concurrent
-- reads and writes keep running) and holding ACCESS EXCLUSIVE for the length of
-- a full scan of the product's largest table. The two-step is worth it here even
-- though the table is small today, because the whole point of this change is
-- that it is about to stop being small.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'chat_messages_author_present'
      and conrelid = 'public.chat_messages'::regclass
  ) then
    alter table public.chat_messages
      add constraint chat_messages_author_present
      check (sender_id is not null or author_name is not null) not valid;
  end if;
end
$$;

alter table public.chat_messages validate constraint chat_messages_author_present;

-- ---------------------------------------------------------------------------
-- 4. Restore the idempotency index for null-sender rows.
--
-- `idx_chat_messages_dedupe` is UNIQUE (channel_id, sender_id, client_message_id)
-- WHERE client_message_id is not null. Postgres treats NULLs in a unique index as
-- distinct by default, so the moment `sender_id` can be NULL that index stops
-- enforcing anything for exactly the rows that need it most: a re-run importer
-- would insert the whole archive a second time with no error.
--
-- NULLS NOT DISTINCT (PG15+) makes (channel_id, NULL, <snowflake>) collide the way
-- it must. Live rows always carry a sender, so nothing about their behaviour
-- changes -- the third column is what distinguishes them and it was never null
-- inside the partial predicate.
--
-- The importer therefore writes the Discord *message* snowflake into
-- `client_message_id`: it is the existing idempotency slot, it is already the
-- column this index is built on, and the repository already translates its unique
-- violation into `ChatMessageDuplicateError`. `author_external_id` is the
-- *author's* id and is deliberately NOT part of this key -- two messages from the
-- same author in the same channel share it, so keying on it would reject the
-- second one.
drop index if exists public.idx_chat_messages_dedupe;
create unique index if not exists idx_chat_messages_dedupe
  on public.chat_messages (channel_id, sender_id, client_message_id)
  nulls not distinct
  where client_message_id is not null;

-- ---------------------------------------------------------------------------
-- 5. One index on author identity.
--
-- Partial, because it only ever serves imported rows: "show me everything this
-- Discord author wrote", and the phase-2 importer's author -> avatar resolution.
-- Live chat never queries it, so the partial predicate keeps it out of the hot
-- insert path's write amplification for every ordinary send.
create index if not exists idx_chat_messages_author_external
  on public.chat_messages (author_external_id)
  where author_external_id is not null;
