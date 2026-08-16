-- Chat unread + mention counts (C1 of #937).
--
-- Mobile chat needs per-channel unread and mention badges, and the server has
-- never been able to answer either question. The read cursor already exists and
-- is written on every channel open (`POST /v1/channels/{id}/read` ->
-- `channel_read_receipts.last_read_at`), but nothing has ever read it back —
-- `findByChannelAndUser` has zero production call sites and `GET /v1/channels`
-- returns raw rows with no aggregation. Mentions did not exist as data at all.
--
-- No new table: the cursor we need is already stored. Two schema additions and
-- one function.

-- ---------------------------------------------------------------------------
-- 1. Mentions as first-class data.
--
-- The push worker has been reading a top-level `mentions` field off the message
-- row through a structural cast since it was written, over a column that has
-- never existed — so it always resolved to empty and the `mentions` push tier
-- has never fired for anyone. This is the column it was always assuming.
--
-- `uuid[]` of `users.id` (the application id, not `supabase_auth_id`), matching
-- `chat_messages.sender_id`. Resolved server-side at send time: a client-supplied
-- mention list would be forgeable, and mentions override per-channel mute in the
-- push rules, so a forged list would let any member force a push to any other
-- member in a channel they had deliberately muted.
alter table public.chat_messages
  add column if not exists mentions uuid[] not null default '{}';

-- No index on `mentions`, deliberately.
--
-- The obvious move is a GIN index, and it would be dead weight. The only reader
-- is `get_channel_unread_counts` below, which tallies mentions inside an
-- aggregate `filter (where ...)` over rows the join is already walking — an
-- aggregate filter is not a row-selection predicate, so the planner cannot
-- consult an index for it at all. Verified on 20k rows: the plan is a seq scan
-- on `chat_messages` with the index present and with it absent.
--
-- It would also cost real write amplification on the product's hottest insert
-- path for that nothing.
--
-- If a "my mentions" inbox is built later it *can* be indexed, but only if the
-- predicate is spelled as containment: `mentions @> array[$1]` uses a GIN index
-- (confirmed: Bitmap Index Scan), while the equivalent-looking
-- `$1 = any (mentions)` does not and seq-scans regardless. Add the index in the
-- change that adds that query, spelled to match it.

-- ---------------------------------------------------------------------------
-- 2. Index the lookup the unread count actually performs.
--
-- `channel_read_receipts` carries only its primary key and `unique (channel_id,
-- user_id)`. The unread join goes the other way — one member, every channel — so
-- it leads with `user_id`, which the existing unique index cannot serve.
create index if not exists idx_channel_read_receipts_user
  on public.channel_read_receipts (user_id, channel_id);

-- ---------------------------------------------------------------------------
-- 3. One round trip for the whole channel list.
--
-- `security definer` is required, not a shortcut: both `chat_channels` and
-- `channel_read_receipts` have RLS enabled with zero policies
-- (`00000000000000_initial_schema.sql:468,471`), which denies everything to
-- non-service roles. The API holds the service-role key and enforces access in
-- the application layer, so this function is only ever reached through it.
--
-- `set search_path = public` is mandatory on a `security definer` function: it
-- runs with the owner's rights, so a caller-controlled `search_path` could
-- otherwise resolve `chat_messages` to an attacker-owned relation.
create or replace function public.get_channel_unread_counts(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (channel_id uuid, unread_count bigint, mention_count bigint)
language sql
stable
security definer
set search_path = public
as $$
  select
    c.id,
    count(m.id) filter (where m.id is not null),
    count(m.id) filter (where p_user_id = any (m.mentions))
  from chat_channels c
  left join channel_read_receipts r
    on r.channel_id = c.id
   and r.user_id = p_user_id
  left join chat_messages m
    on m.channel_id = c.id
   -- A deleted message is not unread.
   and m.is_deleted = false
   -- Your own messages are never unread to you. Without this every send would
   -- light up your own badge until you reopened the channel you just posted in.
   and m.sender_id <> p_user_id
   -- No receipt means never opened, so everything counts. `-infinity` is what
   -- makes the left join's null cursor behave that way rather than counting zero.
   and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
  where c.chapter_id = p_chapter_id
  group by c.id;
$$;

-- The function reads across every channel in a chapter, so it must not be
-- reachable by an end-user JWT. Channel-level access is filtered by the service
-- against the same predicate the rest of chat uses, rather than duplicated here.
--
-- `public` always exists, so its revoke is unguarded. anon/authenticated/
-- service_role are Supabase-managed and absent in bare Postgres substrates
-- (PGlite in CI), so guard each on role existence to keep the migration
-- portable — same idiom as the other RPC migrations.
revoke execute on function public.get_channel_unread_counts(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_channel_unread_counts(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_channel_unread_counts(uuid, uuid) to service_role;
  end if;
end
$$;
