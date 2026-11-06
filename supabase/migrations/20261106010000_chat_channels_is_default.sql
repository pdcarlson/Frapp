-- The chapter's default channel: where Chat opens for a member whose device
-- has no last channel (owner, 2026-11-06: officers pick it; members do not get
-- a pick of their own, because Chat already reopens their last channel).
--
--   is_default  true on at most one channel per chapter.
--
-- Not null with a constant default, so adding it rewrites no row (Postgres
-- 11+ stores the default in the catalog). Every chapter starts with no
-- default, which keeps today's landing: `#general`, else the first channel.
-- The API refuses it on a DM or group DM and moves it off the old channel
-- before setting a new one.

alter table public.chat_channels
  add column if not exists is_default boolean not null default false;

-- One default per chapter. Partial, so it holds one entry per chapter that
-- has set a default and nothing for the rest.
create unique index if not exists chat_channels_one_default_per_chapter
  on public.chat_channels (chapter_id)
  where is_default;

-- Moves the chapter default to one channel in one transaction: the old
-- default is unset and the new one set together, or neither is. The advisory
-- lock serializes two officers setting different defaults at once, so the
-- second waits, then moves it again, instead of tripping the unique index.
-- Never a DM or group DM: zero rows come back, and the API has refused
-- that case already.
--
-- `security invoker`, like the sibling atomic RPCs (`leave_group_dm`): the
-- API calls it with the service-role client, and EXECUTE is locked to
-- service_role below.
create or replace function set_chat_channel_default(
  p_channel_id uuid,
  p_chapter_id uuid
)
returns setof chat_channels
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform pg_advisory_xact_lock(
    hashtextextended('chat_channels.is_default:' || p_chapter_id::text, 0)
  );
  update chat_channels
     set is_default = false
   where chapter_id = p_chapter_id
     and is_default
     and id <> p_channel_id;
  return query
    update chat_channels
       set is_default = true
     where id = p_channel_id
       and chapter_id = p_chapter_id
       and type not in ('DM', 'GROUP_DM')
    returning *;
end;
$$;

revoke execute on function set_chat_channel_default(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function set_chat_channel_default(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function set_chat_channel_default(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function set_chat_channel_default(uuid, uuid) to service_role;
  end if;
end
$$;
