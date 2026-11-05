-- A Discord import can keep the server's categories as channel groups.
--
-- Discord sorts a server's channels into categories, and Frapp already has
-- the same thing: `chat_channel_categories`, which Chat admin manages and both
-- clients draw as sidebar sections. The import read every channel's category
-- name (`discord_category`) only to group the mapping step, then created every
-- channel with `category_id = null`, so a 78-channel server landed as one flat
-- list. The owner asked for the groups to come across when the admin chooses
-- it (2026-11-05).
--
-- 1. Three columns on `discord_import_channels`:
--    - `new_channel_group`: the name of the Frapp group the channel this row
--      creates goes into, chosen on the mapping step (null: no group). Only a
--      `create_new` row may carry one. A merge leaves its channel where it is.
--    - `discord_category_position`: the category's position in Discord, read
--      by the bot scan, so the groups an import makes come in Discord's order.
--      Null on an upload, whose export says nothing about order.
--    - `new_channel_category_id`: the group `start` resolved that name to, in
--      this chapter. `on delete set null`: an officer may delete a group at
--      any time, and a channel the import still has to make then lands with
--      no group rather than failing the import.
--
-- 2. `discord_import_created_categories` records each group `start` created
--    for an import, as `discord_import_created_channels` records channels
--    (20260930030000), so deleting the import can find it again.
--
-- 3. `delete_empty_discord_import_categories` is the purge's group step, run
--    after its channel step, and also run by `start` once it has resolved
--    the groups, so a remap that dropped a category doesn't leave its group
--    behind empty. A candidate is a group this import created, or a group a
--    `purging` or `purged` import created that this import put channels into
--    (that import's purge had to keep it while this import's channels sat in
--    it, as #2922 re-reaps channels). It deletes a candidate only when no
--    channel is in it and no mapping row of an import that isn't being or
--    hasn't been deleted points at it (a finished import's row counts, as its
--    record of where its channels went). Each is checked once unlocked, then
--    locked and checked again: putting a channel or a mapping row in a group
--    takes a key-share lock on the group's row (the foreign keys), so the
--    `for update` waits for it and the second check sees it. Returns the ids
--    it deleted. Does nothing unless the import is being purged or is in a
--    state `start` runs from (`draft`, `ready`, `failed`): never while the
--    worker is writing it.
--
-- Service role only, like the other Discord import functions. The new table
-- has RLS on and no policies. Nothing is rewritten at apply time: every
-- existing row gets nulls, which is the behaviour it had.

-- ---------------------------------------------------------------------------
-- 1. The mapping columns.
alter table public.discord_import_channels
  add column if not exists new_channel_group text,
  add column if not exists discord_category_position integer,
  add column if not exists new_channel_category_id uuid
    references public.chat_channel_categories(id) on delete set null;

alter table public.discord_import_channels
  drop constraint if exists discord_import_channels_group_only_new;
alter table public.discord_import_channels
  add constraint discord_import_channels_group_only_new check (
    (new_channel_group is null and new_channel_category_id is null)
    or mapping_action = 'create_new'
  );

alter table public.discord_import_channels
  drop constraint if exists discord_import_channels_group_name_length;
alter table public.discord_import_channels
  add constraint discord_import_channels_group_name_length check (
    new_channel_group is null
    or char_length(btrim(new_channel_group)) between 1 and 100
  );

-- Serves the `on delete set null` when an officer deletes a group, and the
-- purge's "still meant for" check.
create index if not exists idx_discord_import_channels_category
  on public.discord_import_channels (new_channel_category_id)
  where new_channel_category_id is not null;

-- ---------------------------------------------------------------------------
-- 2. What each import created.
create table if not exists public.discord_import_created_categories (
  import_id   uuid not null references public.discord_imports(id) on delete cascade,
  category_id uuid not null references public.chat_channel_categories(id) on delete cascade,
  created_at  timestamptz not null default now(),
  primary key (import_id, category_id)
);

create index if not exists idx_discord_import_created_categories_category
  on public.discord_import_created_categories (category_id);

alter table public.discord_import_created_categories enable row level security;

-- Serves the emptiness check, and an officer's group delete setting each
-- channel's `category_id` to null.
create index if not exists idx_chat_channels_category
  on public.chat_channels (category_id)
  where category_id is not null;

-- ---------------------------------------------------------------------------
-- 3. The purge's group step.
create or replace function public.discord_import_category_holds_anything(
  p_category_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from chat_channels where category_id = p_category_id)
      or exists (
        select 1
          from discord_import_channels m
          join discord_imports i on i.id = m.import_id
         where m.new_channel_category_id = p_category_id
           and i.status not in ('purging', 'purged')
      );
$$;

create or replace function public.delete_empty_discord_import_categories(
  p_import_id uuid,
  p_chapter_id uuid
)
returns setof uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_category uuid;
begin
  if not exists (
    select 1
      from discord_imports
     where id = p_import_id
       and chapter_id = p_chapter_id
       and status in ('purging', 'draft', 'ready', 'failed')
  ) then
    return;
  end if;

  for v_category in
    select g.id
      from chat_channel_categories g
     where g.chapter_id = p_chapter_id
       and (
         exists (
           select 1
             from discord_import_created_categories r
            where r.import_id = p_import_id
              and r.category_id = g.id
         )
         or exists (
           select 1
             from discord_import_channels m
             join discord_import_created_categories r on r.category_id = m.new_channel_category_id
             join discord_imports o on o.id = r.import_id
            where m.import_id = p_import_id
              and m.new_channel_category_id = g.id
              and o.chapter_id = p_chapter_id
              and o.status in ('purging', 'purged')
         )
       )
     order by g.id
  loop
    if public.discord_import_category_holds_anything(v_category) then
      continue;
    end if;

    perform 1
       from chat_channel_categories
      where id = v_category
        and chapter_id = p_chapter_id
        for update;
    if not found then
      continue;
    end if;

    if public.discord_import_category_holds_anything(v_category) then
      continue;
    end if;

    delete from chat_channel_categories where id = v_category and chapter_id = p_chapter_id;
    return next v_category;
  end loop;
end;
$$;

revoke execute on function public.delete_empty_discord_import_categories(uuid, uuid) from public;
revoke execute on function public.discord_import_category_holds_anything(uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.delete_empty_discord_import_categories(uuid, uuid) from anon;
    revoke execute on function public.discord_import_category_holds_anything(uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.delete_empty_discord_import_categories(uuid, uuid) from authenticated;
    revoke execute on function public.discord_import_category_holds_anything(uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_empty_discord_import_categories(uuid, uuid) to service_role;
    grant execute on function public.discord_import_category_holds_anything(uuid) to service_role;
  end if;
end
$$;
