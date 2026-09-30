-- A channel a Discord import merged into can be deleted (#2922).
--
-- `discord_import_channels.target_channel_id` is `on delete set null`, so that
-- deleting a Signet channel keeps the import's record of what it did. But the
-- `discord_import_channels_target_present` CHECK required a target on every
-- `use_existing` row, so the cascade's SET NULL violated it and the whole
-- DELETE rolled back. Every channel any import ever merged into, including a
-- chapter's #general and those of imports purged long ago, could not be
-- deleted: `DELETE /v1/channels/:id` answered 500.
--
-- 1. The CHECK is replaced by one that asks only what the database can keep
--    true for the row's whole life: a `create_new` row names its new channel.
--    "A `use_existing` row names its target" is a rule about a decision, so it
--    lives where decisions are made: the mapping routes refuse a merge with no
--    target (`assertDecisionResolvable`), `start` refuses an import holding
--    one, and the worker fails the import with a sentence when the channel it
--    merges into is deleted while it waits or runs.
--
-- 2. The purge's keep rule stops counting a merge that can never write again.
--    `discord_import_channel_holds_anything` kept any channel a `use_existing`
--    row of any import pointed at, because deleting it would fail the CHECK.
--    Now only an import that may still write pins the channel it merges into:
--    one that isn't `purging` or `purged`. So the import being purged no
--    longer pins a channel it created and then merged into itself (a failed
--    import remapped through the API), and a merge by an import already
--    deleted pins nothing.
--
-- 3. The purge also reaps a channel an earlier purge had to keep. When import
--    A created a channel and import B merged into it, A's purge kept it (it
--    held B's messages, or B's merge pinned it). B's purge now also considers
--    each channel B merged into that a `purged` import recorded creating in
--    `discord_import_created_channels`, and deletes it under the same checks
--    and row lock as B's own. A channel an older purge left behind that no
--    later purge revisits stays until an officer deletes it, which (1) now
--    allows.
--
-- The functions keep their signatures, `security invoker` and service-role-
-- only grants; the grants are re-stated so this file stands alone. Nothing is
-- rewritten at apply time, and the new CHECK is weaker than the old one, so
-- every existing row passes it.

-- ---------------------------------------------------------------------------
-- 1. The CHECK.
alter table public.discord_import_channels
  drop constraint if exists discord_import_channels_target_present;
alter table public.discord_import_channels
  drop constraint if exists discord_import_channels_new_name_present;
alter table public.discord_import_channels
  add constraint discord_import_channels_new_name_present check (
    mapping_action <> 'create_new' or new_channel_name is not null
  );

-- ---------------------------------------------------------------------------
-- 2. What a channel holds that the purge must keep.
create or replace function public.discord_import_channel_holds_anything(
  p_channel_id uuid,
  p_chapter_id uuid
)
returns boolean
language sql
stable
security invoker
set search_path = public, pg_temp
as $$
  select exists (select 1 from chat_messages where channel_id = p_channel_id)
      or exists (select 1 from chat_message_attachments where channel_id = p_channel_id)
      or exists (
        select 1
          from point_transactions
         where chapter_id = p_chapter_id
           and channel_id = p_channel_id
      )
      or exists (
        select 1
          from discord_import_channels m
          join discord_imports i on i.id = m.import_id
         where m.target_channel_id = p_channel_id
           and m.mapping_action = 'use_existing'
           and i.status not in ('purging', 'purged')
      );
$$;

-- ---------------------------------------------------------------------------
-- 3. The purge's channel step, with the second set of candidates.
create or replace function public.delete_empty_discord_import_channels(
  p_import_id uuid,
  p_chapter_id uuid
)
returns setof uuid
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_channel uuid;
begin
  if not exists (
    select 1
      from discord_imports
     where id = p_import_id
       and chapter_id = p_chapter_id
       and status = 'purging'
  ) then
    return;
  end if;

  for v_channel in
    select c.id
      from chat_channels c
     where c.chapter_id = p_chapter_id
       and (
         -- What this import created: recorded, or for an import from before
         -- the record, named by a `create_new` row and carrying the worker's
         -- description (20260930030000 explains both tests).
         exists (
           select 1
             from discord_import_created_channels r
            where r.import_id = p_import_id
              and r.channel_id = c.id
         )
         or exists (
           select 1
             from discord_import_channels m
             join discord_imports i on i.id = m.import_id
            where m.import_id = p_import_id
              and m.mapping_action = 'create_new'
              and m.target_channel_id = c.id
              and c.created_at >= i.created_at
              and c.description = 'Imported from Discord #' || m.discord_channel_name
         )
         -- What an import already purged created and this one merged into
         -- (#2922), which that purge had to keep.
         or exists (
           select 1
             from discord_import_channels m
             join discord_import_created_channels r on r.channel_id = m.target_channel_id
             join discord_imports o on o.id = r.import_id
            where m.import_id = p_import_id
              and m.mapping_action = 'use_existing'
              and m.target_channel_id = c.id
              and o.chapter_id = p_chapter_id
              and o.status = 'purged'
         )
       )
     order by c.id
  loop
    -- Unlocked first, so a channel that is kept is never locked.
    if public.discord_import_channel_holds_anything(v_channel, p_chapter_id) then
      continue;
    end if;

    perform 1
       from chat_channels
      where id = v_channel
        and chapter_id = p_chapter_id
        for update;
    if not found then
      continue;
    end if;

    -- Again under the lock: a send that committed meanwhile is seen here.
    if public.discord_import_channel_holds_anything(v_channel, p_chapter_id) then
      continue;
    end if;

    delete from chat_channels where id = v_channel and chapter_id = p_chapter_id;
    return next v_channel;
  end loop;
end;
$$;

revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from public;
revoke execute on function public.discord_import_channel_holds_anything(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from anon;
    revoke execute on function public.discord_import_channel_holds_anything(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from authenticated;
    revoke execute on function public.discord_import_channel_holds_anything(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_empty_discord_import_channels(uuid, uuid) to service_role;
    grant execute on function public.discord_import_channel_holds_anything(uuid, uuid) to service_role;
  end if;
end
$$;
