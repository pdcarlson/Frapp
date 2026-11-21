-- A GIF as a conversation's latest message (#4657).
--
-- spec/behavior/chat/README.md § GIFs owns the rule: a GIF message has no
-- text, so Chat home's preview has to be told it is a GIF to read
-- "Jake: GIF" rather than "Jake: Message". `get_channel_latest_messages`
-- gains `has_gif`, true when the latest message's `metadata.gif` is set. The
-- GIF itself is not served: the preview needs only the word.
--
-- 1. `get_channel_latest_messages` is redefined from
--    `20261113185033_chat_message_forwarded_from.sql`; the only change is the
--    `has_gif` column. Its return type changes, so it is dropped and created
--    again, in this migration's transaction, so no reader sees it missing.
-- 2. A thread reply can be a GIF now (#4657), so the parent's thread card
--    has to say so too: `chat_thread_reply_preview` (from
--    `20261112121000_chat_thread_last_reply.sql`) gains a `has_gif` key, and
--    the parents whose held reply is already a GIF are backfilled.

drop function if exists public.get_channel_latest_messages(uuid, uuid);

create function public.get_channel_latest_messages(
  p_chapter_id uuid,
  p_user_id    uuid
)
returns table (
  channel_id       uuid,
  message_id       uuid,
  sender_id        uuid,
  author_name      text,
  content          text,
  kind             text,
  payload          jsonb,
  attachment_count integer,
  created_at       timestamptz,
  forwarded_from   jsonb,
  has_gif          boolean
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select
    c.id,
    m.id,
    m.sender_id,
    m.author_name,
    left(m.content, 500),
    m.kind,
    case when m.kind = 'system_audit' then m.payload end,
    case
      when jsonb_typeof(m.metadata -> 'attachment_count') = 'number'
       and (m.metadata ->> 'attachment_count') ~ '^[0-9]{1,6}$'
      then (m.metadata ->> 'attachment_count')::integer
      else 0
    end,
    m.created_at,
    case
      when m.forwarded_from is null then null
      when exists (
        select 1
          from chat_member_blocks b
         where b.chapter_id = p_chapter_id
           and b.blocker_user_id = p_user_id
           and b.blocked_user_id::text = m.forwarded_from ->> 'sender_id'
      ) then jsonb_build_object(
        'message_id', m.forwarded_from -> 'message_id',
        'channel_id', m.forwarded_from -> 'channel_id',
        'sender_id', m.forwarded_from -> 'sender_id',
        'created_at', m.forwarded_from -> 'created_at',
        'author_name', null,
        'content', '',
        'gif', null,
        'attachment_count', 0,
        'deleted', coalesce((m.forwarded_from ->> 'deleted')::boolean, false),
        'sender_blocked', true
      )
      else m.forwarded_from
        || jsonb_build_object(
          'content', left(coalesce(m.forwarded_from ->> 'content', ''), 500),
          'sender_blocked', false
        )
    end,
    coalesce(jsonb_typeof(m.metadata -> 'gif') = 'object', false)
  from chat_channels c
  cross join lateral (
    select
      msg.id,
      msg.sender_id,
      msg.author_name,
      msg.content,
      msg.kind,
      msg.payload,
      msg.metadata,
      msg.created_at,
      msg.forwarded_from
    from chat_messages msg
    where msg.channel_id = c.id
      and msg.thread_root_id is null
      and msg.is_deleted = false
      and not exists (
        select 1
          from chat_member_blocks b
         where b.chapter_id = p_chapter_id
           and b.blocker_user_id = p_user_id
           and b.blocked_user_id = msg.sender_id
      )
    order by msg.created_at desc, msg.id desc
    limit 1
  ) m
  where c.chapter_id = p_chapter_id;
$$;

revoke execute on function public.get_channel_latest_messages(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.get_channel_latest_messages(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.get_channel_latest_messages(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.get_channel_latest_messages(uuid, uuid) to service_role;
  end if;
end
$$;

-- 2. The thread card's latest reply --------------------------------------------

-- Redefined from `20261112121000_chat_thread_last_reply.sql` with one more
-- key. Same signature, so `create or replace` keeps its grants and every
-- trigger that calls it.
create or replace function public.chat_thread_reply_preview(
  m public.chat_messages
)
returns jsonb
language sql
immutable
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'id', m.id,
    'sender_id', m.sender_id,
    'content', left(coalesce(m.content, ''), 500),
    'kind', m.kind,
    'attachment_count', case
      when jsonb_typeof(m.metadata -> 'attachment_count') = 'number'
        then m.metadata -> 'attachment_count'
      else '0'::jsonb
    end,
    'has_gif', coalesce(jsonb_typeof(m.metadata -> 'gif') = 'object', false),
    'created_at', m.created_at
  )
$$;

-- The API took a GIF with a `thread_root_id` before any client sent one, so
-- a parent may already hold a GIF reply. Only those rows are touched.
update public.chat_messages p
   set thread_last_reply = p.thread_last_reply || '{"has_gif": true}'::jsonb
  from public.chat_messages r
 where p.thread_last_reply is not null
   and r.id::text = p.thread_last_reply ->> 'id'
   and jsonb_typeof(r.metadata -> 'gif') = 'object';
