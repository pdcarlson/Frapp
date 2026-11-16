-- Who can see a Documents folder or file (#3642 piece 1, Paul 2026-11-16).
--
-- The same answer a chat channel gives (20261111233000, groups 20261113040007):
-- `null` is everyone who can open Documents, or a list of `tier:<id>`,
-- `role:<id>` and `group:<id>` entries, checked by `chat_access_list_valid`.
--
-- - chapter_document_folders.who_can_see: who sees the folder and, unless a
--   file narrows it, its files.
-- - chapter_documents.who_can_see: `null` is "same as its folder"; a list is
--   the file's own, and a member must pass both the folder's and the file's,
--   so a file is never wider than its folder.
--
-- Both tables stay API-only (RLS on, no client policies), so the API's
-- `document-access.ts` is the gate; nothing here reads the lists. Deleting a
-- role, tier or group takes its entry off every list, as it does for channels,
-- and a list left empty admits only `*` (and the file's uploader, in the API).
-- Adds two nullable columns, a trigger, and the folder rename and delete
-- functions below; writes no rows.

alter table public.chapter_document_folders
  add column if not exists who_can_see text[];
alter table public.chapter_documents
  add column if not exists who_can_see text[];

alter table public.chapter_document_folders
  drop constraint if exists chapter_document_folders_who_can_see_valid;
alter table public.chapter_document_folders
  add constraint chapter_document_folders_who_can_see_valid
  check (public.chat_access_list_valid(who_can_see));

alter table public.chapter_documents
  drop constraint if exists chapter_documents_who_can_see_valid;
alter table public.chapter_documents
  add constraint chapter_documents_who_can_see_valid
  check (public.chat_access_list_valid(who_can_see));

comment on column public.chapter_document_folders.who_can_see is
  'Who sees the folder and its files: null is everyone who can open Documents, a list holds tier:, role: and group: entries. See 20261116185618_document_who_can_see.sql.';
comment on column public.chapter_documents.who_can_see is
  'Null is same as its folder; a list narrows the folder''s (a member passes both). See 20261116185618_document_who_can_see.sql.';

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
  return old;
end;
$$;

revoke execute on function public.document_access_strip_entry() from public;

drop trigger if exists roles_strip_document_access on public.roles;
create trigger roles_strip_document_access
  after delete on public.roles
  for each row execute function public.document_access_strip_entry('role');

drop trigger if exists role_tiers_strip_document_access on public.role_tiers;
create trigger role_tiers_strip_document_access
  after delete on public.role_tiers
  for each row execute function public.document_access_strip_entry('tier');

drop trigger if exists chapter_groups_strip_document_access on public.chapter_groups;
create trigger chapter_groups_strip_document_access
  after delete on public.chapter_groups
  for each row execute function public.document_access_strip_entry('group');

-- ---------------------------------------------------------------------------
-- Renaming and deleting a folder, each one transaction.
--
-- Documents record their folder by name, and a file under a name no folder
-- row claims has no folder list to pass. Done as two API writes, a rename
-- that re-filed the documents and then failed to rename the row (or lost a
-- race to an open folder of the new name) would leave a restricted folder's
-- files open to the chapter; so would a delete that moved the files to the
-- top level without their list. Each is one statement-set here instead.
-- ---------------------------------------------------------------------------

-- Re-files the folder's documents and renames its row together. A name the
-- chapter already uses fails on `chapter_document_folders`' unique index and
-- rolls both back. Returns the renamed row, or nothing when it isn't there.
create or replace function public.rename_document_folder(
  p_chapter_id uuid,
  p_folder_id uuid,
  p_name text
)
returns setof public.chapter_document_folders
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_old text;
begin
  select name into v_old
    from public.chapter_document_folders
   where id = p_folder_id and chapter_id = p_chapter_id
   for update;
  if not found then
    return;
  end if;
  update public.chapter_documents
     set folder = p_name
   where chapter_id = p_chapter_id and folder = v_old;
  return query
    update public.chapter_document_folders
       set name = p_name
     where id = p_folder_id and chapter_id = p_chapter_id
    returning *;
end;
$$;

-- Moves the folder's documents to the top level and deletes its row. A
-- restricted folder's list goes with its files first, so none is opened by
-- the move: a file on "Same as folder" takes the folder's list, and a file
-- with its own keeps only the entries both lists hold (never wider than it
-- was; an entry only one of them held drops, which can narrow it). Returns
-- whether there was a folder to delete.
create or replace function public.delete_document_folder(
  p_chapter_id uuid,
  p_folder_id uuid
)
returns boolean
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_folder public.chapter_document_folders;
begin
  select * into v_folder
    from public.chapter_document_folders
   where id = p_folder_id and chapter_id = p_chapter_id
   for update;
  if not found then
    return false;
  end if;
  if v_folder.who_can_see is not null then
    update public.chapter_documents
       set who_can_see = case
             when who_can_see is null then v_folder.who_can_see
             else array(
               select entry from unnest(who_can_see) as entry
                where entry = any (v_folder.who_can_see)
             )
           end
     where chapter_id = p_chapter_id and folder = v_folder.name;
  end if;
  update public.chapter_documents
     set folder = null
   where chapter_id = p_chapter_id and folder = v_folder.name;
  delete from public.chapter_document_folders
   where id = p_folder_id and chapter_id = p_chapter_id;
  return true;
end;
$$;

-- API-only, like the tables: the service role calls them. The roles are
-- checked first, as `delete_role`'s grants are, for a database without them.
revoke execute on function public.rename_document_folder(uuid, uuid, text)
  from public;
revoke execute on function public.delete_document_folder(uuid, uuid)
  from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.document_access_strip_entry() from anon;
    revoke execute on function public.rename_document_folder(uuid, uuid, text) from anon;
    revoke execute on function public.delete_document_folder(uuid, uuid) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.document_access_strip_entry() from authenticated;
    revoke execute on function public.rename_document_folder(uuid, uuid, text) from authenticated;
    revoke execute on function public.delete_document_folder(uuid, uuid) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.rename_document_folder(uuid, uuid, text) to service_role;
    grant execute on function public.delete_document_folder(uuid, uuid) to service_role;
  end if;
end
$$;
