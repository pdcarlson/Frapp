-- All threads (#4960): every thread a member follows or muted, across the
-- channels they may read, newest activity first, in one read.
--
-- A member follows a thread when they start one that gets a reply, reply in
-- it, or are mentioned in it (`ChatService.sendMessage`'s auto-follow), so the
-- follow rows already are "the threads I'm part of". `unfollowed` rows (a
-- member who unfollowed, or only read) are left out, as Slack's Threads view
-- leaves out a thread you turned off.
--
-- The caller (the API, as service_role) passes the channel ids it has already
-- authorized; this function decides nothing about access. The unread count is
-- `get_followed_thread_unread`'s rule, so the channel's thread cards and this
-- list never disagree.

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
  latest_reply_id uuid,
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
    (
      select t.id
        from chat_messages t
       where t.thread_root_id = f.thread_root_id
         and t.is_deleted = false
       order by t.created_at desc
       limit 1
    ),
    case when f.state <> 'following' then 0 else (
      select count(*)
        from chat_messages t
       where t.thread_root_id = f.thread_root_id
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
         and t.created_at > coalesce(f.last_read_at, '-infinity'::timestamptz)
    ) end
  from chat_thread_follows f
  join chat_messages r on r.id = f.thread_root_id
  where f.user_id = p_user_id
    and f.channel_id = any (p_channel_ids)
    and f.state in ('following', 'muted')
  order by coalesce(r.thread_last_reply_at, r.created_at) desc, f.thread_root_id
  limit greatest(1, least(coalesce(p_limit, 50), 100));
$$;

revoke execute on function public.get_member_threads(uuid, uuid, uuid[], integer) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_member_threads(uuid, uuid, uuid[], integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_member_threads(uuid, uuid, uuid[], integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_member_threads(uuid, uuid, uuid[], integer) to service_role;
  end if;
end
$$;
