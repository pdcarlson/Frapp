-- Deleting a Discord import also deletes the channels it created, once they
-- hold nothing (#2905).
--
-- The purge removed an import's messages and archive objects but left every
-- channel the import had created, now empty. A re-import of the same server
-- then created each one again: a channel private in Discord never merges into
-- an existing one by default (#2856), and `chat_channels` has no unique
-- `(chapter_id, name)`, so the chapter got a second, like-named channel beside
-- each empty one. Staging's first full import created 59 channels, 57 of them
-- ROLE_GATED.
--
-- `delete_empty_discord_import_channels` runs after the purge has deleted the
-- import's messages. For each channel this import created (a `create_new`
-- mapping row whose `target_channel_id` the worker set), it deletes the channel
-- only when all of these hold:
--
--   - the channel holds no message at all: no live message, no deleted one,
--     no other import's rows, and no `[message deleted]` tombstone;
--   - it holds no attachment row;
--   - no other import's mapping row points at it, and no `use_existing` row
--     of any import does. `discord_import_channels_target_present` requires a
--     `use_existing` row to keep its target, so the `on delete set null` on
--     `target_channel_id` would fail the delete for such a channel anyway.
--
-- A channel the import merged into (`use_existing`) is never a candidate: it
-- was there before the import.
--
-- The channel row is locked before it is checked. A message being sent into it
-- holds a key-share lock on the channel until that insert commits, so the
-- `for update` waits for it, and the check that follows, a new statement in
-- read committed, sees the message and keeps the channel. A send that starts
-- after the lock waits instead, then fails its foreign key once the channel is
-- gone, like a send into any channel an officer deletes.
--
-- Deleting the channel cascades what hangs off it the same way
-- `DELETE /v1/channels/:id` does: read receipts, sidebar pins, and the mapping
-- rows' `target_channel_id` set to null. The roles and read permissions the
-- import created stay, as spec/behavior/chat/README.md § Imported archive
-- messages says.
--
-- Returns the ids it deleted, so the worker can evict them from the channel
-- cache. Does nothing unless the import is being purged, so a running import
-- can never lose a channel it has just created and not yet written to.
--
-- Service role only, like the other Discord import functions.

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
    select distinct m.target_channel_id
      from discord_import_channels m
     where m.import_id = p_import_id
       and m.mapping_action = 'create_new'
       and m.target_channel_id is not null
     order by m.target_channel_id
  loop
    perform 1
       from chat_channels
      where id = v_channel
        and chapter_id = p_chapter_id
        for update;
    if not found then
      continue;
    end if;

    if exists (select 1 from chat_messages where channel_id = v_channel)
       or exists (select 1 from chat_message_attachments where channel_id = v_channel)
       or exists (
         select 1
           from discord_import_channels other
          where other.target_channel_id = v_channel
            and (other.import_id <> p_import_id or other.mapping_action = 'use_existing')
       )
    then
      continue;
    end if;

    delete from chat_channels where id = v_channel and chapter_id = p_chapter_id;
    return next v_channel;
  end loop;
end;
$$;

revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.delete_empty_discord_import_channels(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.delete_empty_discord_import_channels(uuid, uuid) to service_role;
  end if;
end
$$;
