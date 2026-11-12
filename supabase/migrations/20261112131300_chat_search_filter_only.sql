-- Chat search with a filter and no text: per-channel, index-backed (#3965).
--
-- `GET /v1/search` runs with an empty `q` beside a message filter (#3958):
-- `fromUserId`, `after`, `before`, `has` (file, image, link, poll). With no
-- text there is no GIN match to narrow by, and the PostgREST query it ran,
-- `channel_id IN (…100 ids…) … ORDER BY created_at DESC LIMIT 10`, cannot
-- walk `idx_chat_messages_channel_created` in order across an IN list. So it
-- read every message of the 100 channels that passed the filter and sorted
-- them for the top 10: cost linear in the caller's archive.
--
-- `search_chat_messages_filtered` asks each channel for its own newest
-- `p_limit` matches instead (a lateral per channel, each a backward walk of a
-- `(channel_id, created_at desc)` index that stops at the limit), then keeps
-- the newest `p_limit` of those. That is the same answer: the overall newest
-- `p_limit` rows each sit inside their own channel's newest `p_limit`.
--
-- A rare trait would still walk a whole channel looking for its tenth match,
-- so each trait gets an index that holds only its rows, keyed the same way:
--
-- - `poll`: `idx_chat_messages_search_poll`. The existing
--   `idx_chat_messages_poll_cards` (#3897) leads with `created_at`, not the
--   channel, so a per-channel probe can't use it.
-- - `link`: `idx_chat_messages_search_link`, partial on the same constant
--   pattern the query uses, so no new column and no trigram index. The
--   predicate is evaluated on every insert, which is a substring test on the
--   message text.
-- - a sender: one flat query through the existing `idx_chat_messages_sender`
--   instead, which reads only that member's messages; the per-channel walk
--   would probe every channel for someone who may have posted in few.
-- - `file` / `image`: driven from `chat_message_attachments` by its existing
--   `idx_chat_message_attachments_channel`, so the cost is the channel's
--   attachment rows, not its messages. The attachment rows decide, not
--   `metadata.attachment_count`, which an import can under-count.
--
-- The trait conditions are fixed fragments chosen from an allowlist, and every
-- value goes in as a bound parameter, so nothing the caller sends becomes SQL.
-- The statement is built per call (`execute`) so the planner sees which trait
-- conditions are present and can match the partial indexes; a single static
-- statement with `(not p_link or …)` conditions could not.
--
-- Access is the caller's job, unchanged: `SearchService` passes only channel
-- ids that passed `canAccessChannel`, and this reads no other channel. Thread
-- replies and deleted messages are excluded, as in the text search.
--
-- Measured on the local stack (Postgres 17.6), 1,200,000 messages across 300
-- channels of one chapter, 1,200 polls, 36,363 links, 24,023 attachments; the
-- numbers and plans are in the PR for #3965.
--
-- Additive: two partial indexes and one function, no data change. Plain
-- `create index`, as the other index migrations here: Supabase applies each
-- migration in a transaction, where `concurrently` is refused.

create index if not exists idx_chat_messages_search_poll
  on public.chat_messages (channel_id, created_at desc, id desc)
  where kind = 'poll' and is_deleted = false and thread_root_id is null;

create index if not exists idx_chat_messages_search_link
  on public.chat_messages (channel_id, created_at desc, id desc)
  where content ilike '%http%://%' and is_deleted = false and thread_root_id is null;

create or replace function public.search_chat_messages_filtered(
  p_channel_ids uuid[],
  p_sender_id   uuid,
  p_after       timestamptz,
  p_before      timestamptz,
  p_has         text[],
  p_limit       integer
)
returns setof public.chat_messages
language plpgsql
stable
security invoker
set search_path = public, pg_temp
as $$
declare
  v_has   text[] := coalesce(p_has, '{}');
  v_limit integer := least(greatest(coalesce(p_limit, 10), 1), 100);
  v_where text := '';
begin
  if exists (
    select 1 from unnest(v_has) h
    where h not in ('file', 'image', 'link', 'poll')
  ) then
    raise exception 'search_chat_messages_filtered: unknown has value'
      using errcode = '22023';
  end if;
  if coalesce(cardinality(p_channel_ids), 0) = 0 then
    return;
  end if;

  if 'poll' = any (v_has) then
    v_where := v_where || ' and m.kind = ''poll''';
  end if;
  if 'link' = any (v_has) then
    v_where := v_where || ' and m.content ilike ''%http%://%''';
  end if;
  -- An image is an attachment whose content type says so; a file is any
  -- attachment, images included. So `image` alone says everything `file`
  -- does, and a legacy row with a null content type is a file, not an image.
  if 'image' = any (v_has) then
    v_where := v_where || ' and m.id in (select a.message_id'
      || ' from public.chat_message_attachments a'
      || ' where a.channel_id = m.channel_id and a.content_type like ''image/%'')';
  elsif 'file' = any (v_has) then
    v_where := v_where || ' and m.id in (select a.message_id'
      || ' from public.chat_message_attachments a where a.channel_id = m.channel_id)';
  end if;

  -- A sender narrows by `idx_chat_messages_sender` to that member's own
  -- messages, so one flat query over the channel list stays bounded by them;
  -- a per-channel walk would probe every channel for a member who may have
  -- posted in few.
  if p_sender_id is not null then
    return query execute
      'select m.* from public.chat_messages m'
      || ' where m.channel_id = any ($1)'
      || '   and m.sender_id = $2'
      || '   and m.is_deleted = false'
      || '   and m.thread_root_id is null'
      || '   and m.created_at >= $3 and m.created_at < $4'
      || v_where
      || ' order by m.created_at desc, m.id desc'
      || ' limit $5'
    using
      p_channel_ids,
      p_sender_id,
      coalesce(p_after, '-infinity'::timestamptz),
      coalesce(p_before, 'infinity'::timestamptz),
      v_limit;
    return;
  end if;

  return query execute
    'select h.* from unnest($1) as c(id)'
    || ' cross join lateral ('
    || '   select m.* from public.chat_messages m'
    || '   where m.channel_id = c.id'
    || '     and m.is_deleted = false'
    || '     and m.thread_root_id is null'
    || '     and m.created_at >= $3 and m.created_at < $4'
    || v_where
    || '   order by m.created_at desc, m.id desc'
    || '   limit $5'
    || ' ) h'
    || ' order by h.created_at desc, h.id desc'
    || ' limit $5'
  using
    p_channel_ids,
    p_sender_id,
    coalesce(p_after, '-infinity'::timestamptz),
    coalesce(p_before, 'infinity'::timestamptz),
    v_limit;
end;
$$;

comment on function public.search_chat_messages_filtered(uuid[], uuid, timestamptz, timestamptz, text[], integer) is
  'Chat search with a filter and no text (#3965): each channel''s newest matches through a (channel_id, created_at desc) index, merged. Reads only the channel ids it is handed; the caller decides access. Executable by service_role only.';

revoke execute on function public.search_chat_messages_filtered(uuid[], uuid, timestamptz, timestamptz, text[], integer) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.search_chat_messages_filtered(uuid[], uuid, timestamptz, timestamptz, text[], integer) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.search_chat_messages_filtered(uuid[], uuid, timestamptz, timestamptz, text[], integer) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.search_chat_messages_filtered(uuid[], uuid, timestamptz, timestamptz, text[], integer) to service_role;
  end if;
end;
$$;
