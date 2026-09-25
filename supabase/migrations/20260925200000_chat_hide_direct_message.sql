-- #2303: a member can hide a 1:1 DM for themselves.
--
-- Until this, the only exit from a direct conversation was `POST
-- /v1/channels/:id/leave`, which refuses anything but a Group DM, and the rule
-- that refusal enforces is sound: a 1:1 DM whose member list dropped to one
-- would mean something different from a Group DM that did. So this is a
-- per-member hide, not a leave. It changes no channel row, deletes no message,
-- and leaves the other member's view exactly as it was.
--
-- ---------------------------------------------------------------------------
-- 1. Where the per-member state lives.
--
-- `chat_channels.archived_at` is channel-level, so it cannot say "hidden for
-- one of its two members". A DM has no membership row either: its members are
-- `chat_channels.member_ids`. The one row that already exists per (channel,
-- member) is the read cursor, `channel_read_receipts`, unique on
-- `(channel_id, user_id)` and written on every channel open. `hidden_at` goes
-- there.
--
-- Nullable timestamp rather than a boolean, the same soft-state convention as
-- `chat_channels.archived_at` and `chat_messages.deleted_at`, and here the
-- timestamp is load-bearing: section 3 compares messages against it.
--
-- The table keeps RLS enabled with zero policies
-- (`00000000000000_initial_schema.sql:471`); no client reads it directly, and
-- the API reaches it with the service-role key. Nothing here changes that.
alter table public.channel_read_receipts
  add column if not exists hidden_at timestamptz;

-- ---------------------------------------------------------------------------
-- 2. Hide.
--
-- One upsert, on the database clock. `hidden_at` has to be on the same clock as
-- `chat_messages.created_at` (a column default, `now()`), because section 3
-- asks "is there a message newer than the hide". Stamping it from the API's
-- clock would let a few milliseconds of skew either swallow a message sent just
-- after the hide or resurface the thread on one sent just before it.
--
-- The hide also marks the thread read. A hidden row is not rendered, so an
-- unread count left on it would light the app badge for a conversation the
-- member can no longer see or clear. `greatest` keeps a read cursor the API
-- already wrote from moving backwards.
--
-- The `type = 'DM'` guard repeats the service's type check in the statement
-- itself, the way `leave_group_dm` repeats its own: a row whose type is not
-- `DM` (or that sits in another chapter) inserts nothing and returns no row,
-- which the repository reads as "not found".
--
-- `security invoker`, like `leave_group_dm`: the API calls it with the
-- service-role client, which bypasses RLS, and EXECUTE is locked to
-- service_role below.
create or replace function public.hide_direct_message(
  p_channel_id uuid,
  p_chapter_id uuid,
  p_user_id uuid
)
returns setof public.channel_read_receipts
language sql
security invoker
set search_path = public, pg_temp
as $$
  insert into channel_read_receipts (channel_id, user_id, last_read_at, hidden_at)
  select c.id, p_user_id, now(), now()
    from chat_channels c
   where c.id = p_channel_id
     and c.chapter_id = p_chapter_id
     and c.type = 'DM'
  on conflict (channel_id, user_id) do update
     set last_read_at = greatest(channel_read_receipts.last_read_at, excluded.last_read_at),
         hidden_at = excluded.hidden_at
  returning *;
$$;

-- ---------------------------------------------------------------------------
-- 3. Which DMs are still hidden.
--
-- Unhiding on a new message is derived here, at read time, rather than written
-- on the send path. A DM the member hid stays hidden only while no message
-- newer than the hide exists that the member would actually see:
--
-- - a deleted message does not count;
-- - a message from someone the member has blocked in this chapter does not
--   count. Nothing a blocked member sends reaches the blocker
--   (`spec/behavior/chat/README.md` § What a block does and does not hide), so
--   letting it resurface the thread would deliver exactly the signal the block
--   withholds;
-- - everything else counts, the member's own messages included (sent from
--   another device, say).
--
-- Deriving it keeps a write off the hottest insert path in the product, and it
-- cannot race: there is no "unhide" write for a concurrent send to lose. It
-- also means an unblock resurfaces a thread the blocked member wrote in while
-- the block stood, which is what an unblock should do.
--
-- Clearing `hidden_at` outright happens in one place only: the member opening
-- the DM again themselves (`ChatService.getOrCreateDm`).
--
-- The inner lookups are indexed: `idx_chat_messages_channel` is
-- `(channel_id, created_at)`, and `chat_member_blocks`' unique constraint
-- leads with `(chapter_id, blocker_user_id, ...)`. The outer scan is the
-- viewer's own receipts, via `idx_channel_read_receipts_user`.
create or replace function public.get_hidden_channel_ids(
  p_chapter_id uuid,
  p_user_id uuid
)
returns table (channel_id uuid)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select r.channel_id
    from channel_read_receipts r
    join chat_channels c on c.id = r.channel_id
   where r.user_id = p_user_id
     and r.hidden_at is not null
     and c.chapter_id = p_chapter_id
     and c.type = 'DM'
     and not exists (
       select 1
         from chat_messages m
        where m.channel_id = r.channel_id
          and m.created_at > r.hidden_at
          and m.is_deleted = false
          and not exists (
            select 1
              from chat_member_blocks b
             where b.chapter_id = p_chapter_id
               and b.blocker_user_id = p_user_id
               and b.blocked_user_id = m.sender_id
          )
     );
$$;

-- Both functions take a caller-supplied user id, so neither may be reachable by
-- an end-user JWT: anyone could hide a thread for someone else, or read which
-- DMs another member has hidden. Same idiom as the other RPC migrations —
-- `public` always exists, so its revoke is unguarded; the Supabase-managed
-- roles are absent in bare Postgres (PGlite in CI), so each is guarded.
revoke execute on function public.hide_direct_message(uuid, uuid, uuid) from public;
revoke execute on function public.get_hidden_channel_ids(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.hide_direct_message(uuid, uuid, uuid) from anon;
    revoke execute on function public.get_hidden_channel_ids(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.hide_direct_message(uuid, uuid, uuid) from authenticated;
    revoke execute on function public.get_hidden_channel_ids(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.hide_direct_message(uuid, uuid, uuid) to service_role;
    grant execute on function public.get_hidden_channel_ids(uuid, uuid) to service_role;
  end if;
end
$$;
