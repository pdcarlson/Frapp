-- The latest message in every channel, for the previews on mobile Chat home.
--
-- Chat home's rows were names only (2026-11-06 redesign). Each row now shows
-- the channel's latest message and its time, so the list says something
-- before a channel is opened. Nothing could answer "latest message per
-- channel" in one call: `GET /v1/channels` returns channel rows only, and a
-- page of messages per channel would be one request per row.
--
-- Shaped like `get_channel_unread_counts`, on purpose:
--
-- - `security definer` because `chat_messages`, `chat_channels` and
--   `chat_member_blocks` have RLS with no policies for the API's caller.
-- - A row for every channel in the chapter that has a message, readable or
--   not. Access is decided once, in `ChannelAccessService`, and the service
--   filters these rows by it, as it does the unread counts. A preview of a
--   DM between two other members must never leave the server, so that filter
--   is load-bearing.
--
-- Skipped, as the unread counts skip them: deleted rows and anything from a
-- member the caller blocked. Unlike the counts, the caller's own messages and
-- audit lines are kept: "You: see you at 6" is a useful preview, and an audit
-- line is the only kind of message #chapter-audit has.
--
-- `content` is cut to 500 characters, the most the client's one-line preview
-- flattens (`PREVIEW_SOURCE_LIMIT`, `reply-preview.ts`). `payload` is sent
-- only for an audit line, which the client draws from it (`auditLineText`);
-- a card's payload can be large and the preview names its kind instead.
--
-- One index probe per channel: the lateral walks `idx_chat_messages_channel`
-- (`channel_id, created_at`) backwards and stops at the first row that
-- passes the skips.

create or replace function public.get_channel_latest_messages(
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
  created_at       timestamptz
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
    coalesce((m.metadata ->> 'attachment_count')::integer, 0),
    m.created_at
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
      msg.created_at
    from chat_messages msg
    where msg.channel_id = c.id
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
