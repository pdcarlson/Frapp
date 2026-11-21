-- All threads (#4960): every thread a member follows or muted, across the
-- channels they may read, newest activity first, in one read.
--
-- A member follows a thread when they start one that gets a reply, reply in
-- it, or are mentioned in it (`ChatService.sendMessage`'s auto-follow), so the
-- follow rows already are "the threads I'm part of". `unfollowed` rows (a
-- member who unfollowed, or only read) are left out, as Slack's Threads view
-- leaves out a thread you turned off.
--
-- 1. `chat_thread_unread_count`: how many replies in a thread are new to a
--    member. The one copy of the rule; `get_followed_thread_unread` (the
--    channel's thread cards) is redefined on it, so the cards and All threads
--    cannot disagree.
-- 2. `get_member_thread_channel_ids`: the distinct channels in a chapter that
--    hold the member's followed or muted threads, so the API authorizes a
--    short list of channels rather than reading every follow row (which
--    PostgREST would cut at `max_rows`).
-- 3. `get_member_threads`: the threads themselves, in channels the API has
--    already authorized; this decides nothing about access. The latest reply
--    is the root's own `thread_last_reply`, so it is not looked up here.

-- 1. The unread rule ------------------------------------------------------------

create or replace function public.chat_thread_unread_count(
  p_thread_root_id uuid,
  p_user_id        uuid,
  p_chapter_id     uuid,
  p_last_read_at   timestamptz
)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)
    from chat_messages t
   where t.thread_root_id = p_thread_root_id
     and t.is_deleted = false
     and t.kind <> 'imported'
     and t.sender_id is distinct from p_user_id
     and not exists (
       select 1
         from chat_member_blocks b
        where b.chapter_id = p_chapter_id
          and b.blocker_user_id = p_user_id
          and b.blocked_user_id = t.sender_id
     )
     and t.created_at > coalesce(p_last_read_at, '-infinity'::timestamptz);
$$;

-- Same signature and answer as `20261110220000`, now on the shared rule.
create or replace function public.get_followed_thread_unread(
  p_channel_id uuid,
  p_user_id    uuid
)
returns table (
  thread_root_id uuid,
  state          text,
  last_read_at   timestamptz,
  unread_count   bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    f.thread_root_id,
    f.state,
    f.last_read_at,
    case when f.state <> 'following' then 0 else
      public.chat_thread_unread_count(
        f.thread_root_id,
        p_user_id,
        (select ch.chapter_id from chat_channels ch where ch.id = p_channel_id),
        f.last_read_at
      )
    end
  from chat_thread_follows f
  where f.channel_id = p_channel_id
    and f.user_id = p_user_id
    and f.state in ('following', 'muted');
$$;

-- 2. Which channels to authorize --------------------------------------------------

create or replace function public.get_member_thread_channel_ids(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (channel_id uuid)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select distinct f.channel_id
    from chat_thread_follows f
    join chat_channels ch on ch.id = f.channel_id
   where f.user_id = p_user_id
     and ch.chapter_id = p_chapter_id
     and f.state in ('following', 'muted');
$$;

-- 3. The threads ------------------------------------------------------------------

create or replace function public.get_member_threads(
  p_chapter_id  uuid,
  p_user_id     uuid,
  p_channel_ids uuid[],
  p_limit       integer
)
returns table (
  thread_root_id  uuid,
  channel_id      uuid,
  state           text,
  last_read_at    timestamptz,
  last_reply_at   timestamptz,
  reply_count     integer,
  unread_count    bigint
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    f.thread_root_id,
    f.channel_id,
    f.state,
    f.last_read_at,
    r.thread_last_reply_at,
    r.thread_reply_count,
    case when f.state <> 'following' then 0 else
      public.chat_thread_unread_count(
        f.thread_root_id, p_user_id, p_chapter_id, f.last_read_at
      )
    end
  from chat_thread_follows f
  join chat_messages r on r.id = f.thread_root_id
  where f.user_id = p_user_id
    and f.channel_id = any (p_channel_ids)
    and f.state in ('following', 'muted')
  order by coalesce(r.thread_last_reply_at, r.created_at) desc, f.thread_root_id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

-- Service role only, as every chat read RPC is.
revoke execute on function public.chat_thread_unread_count(uuid, uuid, uuid, timestamptz) from public;
revoke execute on function public.get_member_thread_channel_ids(uuid, uuid) from public;
revoke execute on function public.get_member_threads(uuid, uuid, uuid[], integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.chat_thread_unread_count(uuid, uuid, uuid, timestamptz) from anon;
    revoke execute on function public.get_member_thread_channel_ids(uuid, uuid) from anon;
    revoke execute on function public.get_member_threads(uuid, uuid, uuid[], integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.chat_thread_unread_count(uuid, uuid, uuid, timestamptz) from authenticated;
    revoke execute on function public.get_member_thread_channel_ids(uuid, uuid) from authenticated;
    revoke execute on function public.get_member_threads(uuid, uuid, uuid[], integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.chat_thread_unread_count(uuid, uuid, uuid, timestamptz) to service_role;
    grant execute on function public.get_member_thread_channel_ids(uuid, uuid) to service_role;
    grant execute on function public.get_member_threads(uuid, uuid, uuid[], integer) to service_role;
  end if;
end
$$;
