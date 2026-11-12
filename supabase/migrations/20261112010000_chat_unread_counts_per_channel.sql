-- Unread badges: count each channel's unread messages with an index range scan
-- instead of scanning every chapter's messages (#3728).
--
-- `get_channel_unread_counts` is behind `GET /v1/channels/unread`, the API's
-- most-called route. Its 20261110220000 body left-joined `chat_messages` onto
-- the chapter's channels with every filter in the join condition. The planner
-- estimated one matching row and answered with a sequential scan of the whole
-- table: 43,900 rows on production on 2026-11-11, 43,225 of them imported
-- Discord history that can never be unread, and other chapters' messages too.
-- pg_stat_statements put it at 167 ms mean and 5.9 s max; `explain analyze` of
-- the same body with literal arguments took 1.7 s. It grows with every
-- chapter's history, not with the caller's own unread.
--
-- This body is the same rule written per channel: a lateral aggregate per
-- channel, which the planner drives through `(channel_id, created_at)` from the
-- caller's read cursor. Same filters, same output. Checked on production on
-- 2026-11-11 against the old function for every member of every chapter: the
-- same 324 rows and counts. Prepared with the same arguments as above it ran
-- in 7.4 ms.
--
-- The partial index holds only rows that can ever be unread in a channel
-- (timeline messages that aren't deleted or imported), so a member who never
-- opened a channel full of imported history scans its few live rows, not the
-- archive. It is small: about 660 of production's 43,900 rows today.
--
-- Every message write maintains each index on the table, and send has a hot-path
-- budget, so this also drops `idx_chat_messages_channel` (the initial schema's
-- `(channel_id, created_at)`). `idx_chat_messages_channel_created` covers the
-- same columns descending, which a B-tree scans either way, and the planner
-- already prefers it: production's pg_stat_user_indexes on 2026-11-11 showed
-- 187,506 scans of it and 0 of the one dropped here.

drop index if exists public.idx_chat_messages_channel;

create index if not exists idx_chat_messages_channel_countable
  on public.chat_messages (channel_id, created_at)
  where thread_root_id is null
    and is_deleted = false
    and kind <> 'imported';

create or replace function public.get_channel_unread_counts(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (channel_id uuid, unread_count bigint, mention_count bigint)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    unread.unread_count,
    unread.mention_count + thread_mentions.mention_count
  from chat_channels c
  left join channel_read_receipts r
    on r.channel_id = c.id
   and r.user_id = p_user_id
  cross join lateral (
    select
      count(*) as unread_count,
      count(*) filter (where p_user_id = any (m.mentions)) as mention_count
    from chat_messages m
    where m.channel_id = c.id
      -- A thread reply is not unread in its channel (#3785): it lives in the
      -- thread, and a followed thread shows its own count.
      and m.thread_root_id is null
      -- A deleted message is not unread.
      and m.is_deleted = false
      -- An imported archive message is never unread: it is history the
      -- chapter is importing, not a message anyone sent them.
      and m.kind <> 'imported'
      and m.created_at > coalesce(r.last_read_at, '-infinity'::timestamptz)
      -- Your own messages are never unread to you. `is distinct from` because
      -- sender_id is nullable; a null-sender message is nobody's own.
      and m.sender_id is distinct from p_user_id
      -- A `#chapter-audit` entry is not unread (2026-11-06).
      and not (
        m.kind = 'system_audit'
        and coalesce(m.client_message_id, '') like 'audit:%'
      )
      -- A message from a member you have blocked in this chapter is not
      -- unread, and so not a mention (#2521).
      and not exists (
        select 1
          from chat_member_blocks b
         where b.chapter_id = p_chapter_id
           and b.blocker_user_id = p_user_id
           and b.blocked_user_id = m.sender_id
      )
  ) unread
  cross join lateral (
    -- A thread reply that @mentions you counts until you read the thread or
    -- the channel, whichever is later. Reading the channel clears it too, so a
    -- client without thread UI can never strand a badge, and the channel
    -- receipt bounds the scan to recent replies (the partial index on
    -- (channel_id, created_at)). Same skips as the channel count.
    select count(*) as mention_count
      from chat_messages t
      left join chat_thread_follows f
        on f.thread_root_id = t.thread_root_id
       and f.user_id = p_user_id
     where t.channel_id = c.id
       and t.thread_root_id is not null
       and p_user_id = any (t.mentions)
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
       and t.created_at > coalesce(
         greatest(r.last_read_at, f.last_read_at),
         '-infinity'::timestamptz
       )
  ) thread_mentions
  where c.chapter_id = p_chapter_id;
$$;

revoke execute on function public.get_channel_unread_counts(uuid, uuid) from public;
