-- A Discord import's progress, one line per Discord category.
--
-- The one-import page shows a running bot import as a tile per Discord
-- category ("Committees 8/11"), and a finished one with its channels and
-- threads counted apart. `GET /v1/discord-imports/:id/progress` is polled
-- every few seconds and a server can hold over a thousand channel and thread
-- rows, so the rows are added up here rather than shipped to the API to be
-- added up there.
--
-- A thread's own `discord_category` is not its category: the bot scan writes
-- the parent channel's name there (the gateway's `categoryName` for a
-- thread), which is how the mapping step labels it. So a thread is counted
-- under its parent row's category, joined on the parent's Discord id within
-- the same import (`discord_import_channels_unique`).
--
-- Per category: `channels` (rows with no parent) and `threads` (rows with
-- one) being imported, `done` (imported, or skipped by the worker because
-- Discord no longer showed the channel, as `countChannels` counts it) and
-- `failed`. Rows mapped to skip are in no count, as in every progress count.
-- Channels in no category come first, as Discord lists them, then the
-- categories in Discord's order (`discord_category_position`, null on an
-- upload), then by where the import reaches them.
--
-- Scoped by `p_chapter_id` through the import, like every read of the table.
-- Service role only, like the other Discord import functions.
create or replace function public.discord_import_category_progress(
  p_import_id uuid,
  p_chapter_id uuid
)
returns table (
  category text,
  channels integer,
  threads integer,
  done integer,
  failed integer
)
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  with walked as (
    select
      case
        when m.parent_discord_channel_id is null then m.discord_category
        else p.discord_category
      end as category,
      case
        when m.parent_discord_channel_id is null then m.discord_category_position
        else p.discord_category_position
      end as category_position,
      m.parent_discord_channel_id is not null as is_thread,
      m.status,
      m.position
    from discord_import_channels m
    join discord_imports i
      on i.id = m.import_id
     and i.chapter_id = p_chapter_id
    left join discord_import_channels p
      on p.import_id = m.import_id
     and p.discord_channel_id = m.parent_discord_channel_id
    where m.import_id = p_import_id
      and m.mapping_action <> 'skip'
  )
  select
    category,
    (count(*) filter (where not is_thread))::integer as channels,
    (count(*) filter (where is_thread))::integer as threads,
    (count(*) filter (where status in ('completed', 'skipped')))::integer as done,
    (count(*) filter (where status = 'failed'))::integer as failed
  from walked
  group by category
  order by
    category is not null,
    min(category_position) nulls last,
    min(position);
$$;

revoke execute on function public.discord_import_category_progress(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.discord_import_category_progress(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.discord_import_category_progress(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.discord_import_category_progress(uuid, uuid) to service_role;
  end if;
end
$$;
