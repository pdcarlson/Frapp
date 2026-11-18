-- Read receipts on direct messages (#5519, Paul, 2026-11-18).
--
-- spec/behavior/chat/README.md § Read Receipts owns the rule. The Messages
-- list (the phone's tab, web's Direct messages) shows one check on the
-- caller's own last message once it is sent, and two once it is read.
--
-- 1. `user_settings.read_receipts`, on by default: the member's switch. Off
--    is two-way, as Paul picked: their reads are never reported to anyone,
--    and they are told about no one's.
-- 2. `get_channel_latest_messages`, redefined from
--    `20261114153147_chat_latest_message_gif.sql`, gains `read_status`:
--    `sent` or `read` on a DM or group DM whose latest message is the
--    caller's, null on every other row. Only that word leaves the database,
--    never anyone's read time, and `ChatService.getLatestMessages` already
--    drops every row for a channel the caller can't read. The return type
--    changes, so it is dropped and created again in this migration's
--    transaction, so no reader sees it missing. An API older than this
--    migration ignores the new column; one newer, against a database without
--    it, reads a missing column as no status.

alter table public.user_settings
  add column if not exists read_receipts boolean not null default true;

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
  has_gif          boolean,
  read_status      text
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
    coalesce(jsonb_typeof(m.metadata -> 'gif') = 'object', false),
    case
      -- Only a direct message or group DM, and only the caller's own latest
      -- message, has a status. A channel row, or someone else's message,
      -- carries none. An audit line and an imported message are nobody's to
      -- have sent.
      when c.type not in ('DM', 'GROUP_DM')
        or m.sender_id is distinct from p_user_id
        or m.kind in ('system_audit', 'imported')
        then null
      -- Two-way, like WhatsApp's switch: a caller who turned read receipts
      -- off is told nothing about anyone's reads.
      when not coalesce(
        (select s.read_receipts from user_settings s where s.user_id = p_user_id),
        true
      ) then 'sent'
      -- A conversation with nobody else left in it has nobody to read it.
      when not exists (
        select 1 from unnest(c.member_ids) as other(id) where other.id <> p_user_id
      ) then 'sent'
      -- Read only once every other member has read past it (WhatsApp's group
      -- rule). A member counts as not having read it when they turned read
      -- receipts off (their reads are never reported), when their cursor is
      -- before it, or when they blocked the caller (a block withholds the
      -- caller's messages from them, so a moved cursor says nothing).
      when exists (
        select 1
          from unnest(c.member_ids) as other(id)
         where other.id <> p_user_id
           and (
             not coalesce(
               (select s.read_receipts from user_settings s where s.user_id = other.id),
               true
             )
             or not exists (
               select 1
                 from channel_read_receipts r
                where r.channel_id = c.id
                  and r.user_id = other.id
                  and r.last_read_at >= m.created_at
             )
             or exists (
               select 1
                 from chat_member_blocks b
                where b.chapter_id = p_chapter_id
                  and b.blocker_user_id = other.id
                  and b.blocked_user_id = p_user_id
             )
           )
      ) then 'sent'
      else 'read'
    end
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
