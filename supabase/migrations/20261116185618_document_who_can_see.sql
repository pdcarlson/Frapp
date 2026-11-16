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
-- Adds two nullable columns and a trigger; writes no rows.

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

revoke execute on function public.document_access_strip_entry()
  from public, anon, authenticated;

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
