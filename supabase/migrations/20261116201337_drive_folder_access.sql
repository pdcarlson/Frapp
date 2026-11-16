-- Google Drive sync keeps who-can-see lists (#5220, Paul 2026-11-16).
--
-- Drive sync filed its copies into Documents folders by name, so a rename in
-- Drive made a new folder open to the whole chapter and moved a restricted
-- folder's copies into it. Now:
--
-- - chapter_document_folders.drive_folder_id: the Drive folder a synced
--   folder mirrors. Sync finds the folder by it, so a rename in Drive renames
--   the same row and its list stays. Unique per chapter.
-- - chapter_drive_connections.who_can_see: who sees what the connection
--   brings in. Sync starts the connection's top folder with it, and each new
--   subfolder with its parent's list. Same format as a folder's
--   (20261116185618_document_who_can_see.sql).
-- - chapter_documents.drive_held_folder_id: set when Drive moved a copy into
--   a folder more people may see. Sync leaves the copy where it was and
--   records the folder Drive put it in, until a member who manages documents
--   opens it up. An id, not a name, so a copy's row never names a folder its
--   reader can't see.
--
-- Adds three nullable columns (one a foreign key), a partial unique index and
-- a check, and redefines document_access_strip_entry to clear the
-- connection's list too.
-- Writes no rows.

alter table public.chapter_document_folders
  add column if not exists drive_folder_id text;
alter table public.chapter_drive_connections
  add column if not exists who_can_see text[];
alter table public.chapter_documents
  add column if not exists drive_held_folder_id uuid
    references public.chapter_document_folders (id) on delete set null;

create unique index if not exists chapter_document_folders_drive_folder
  on public.chapter_document_folders (chapter_id, drive_folder_id)
  where drive_folder_id is not null;

alter table public.chapter_drive_connections
  drop constraint if exists chapter_drive_connections_who_can_see_valid;
alter table public.chapter_drive_connections
  add constraint chapter_drive_connections_who_can_see_valid
  check (public.chat_access_list_valid(who_can_see));

comment on column public.chapter_document_folders.drive_folder_id is
  'The Google Drive folder this folder mirrors, or null. Sync matches folders by it. See 20261116201337_drive_folder_access.sql.';
comment on column public.chapter_drive_connections.who_can_see is
  'The list the connection''s top folder starts with: null is everyone who can open Documents. See 20261116201337_drive_folder_access.sql.';
comment on column public.chapter_documents.drive_held_folder_id is
  'For a Drive copy that Drive moved into a folder more people may see: that folder. The copy stays put until someone who manages documents opens it up. See 20261116201337_drive_folder_access.sql.';

-- Deleting a role, tier or group takes its entry off the connection's list
-- too, as it does from folders and files.
create or replace function public.document_access_strip_entry()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_key text := tg_argv[0] || ':' || old.id::text;
begin
  update public.chapter_document_folders
     set who_can_see = array_remove(who_can_see, v_key)
   where chapter_id = old.chapter_id
     and v_key = any (who_can_see);
  update public.chapter_documents
     set who_can_see = array_remove(who_can_see, v_key)
   where chapter_id = old.chapter_id
     and v_key = any (who_can_see);
  update public.chapter_drive_connections
     set who_can_see = array_remove(who_can_see, v_key)
   where chapter_id = old.chapter_id
     and v_key = any (who_can_see);
  return old;
end;
$$;

revoke execute on function public.document_access_strip_entry() from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.document_access_strip_entry() from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.document_access_strip_entry() from authenticated;
  end if;
end
$$;
