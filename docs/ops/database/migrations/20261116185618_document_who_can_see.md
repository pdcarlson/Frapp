# 20261116185618_document_who_can_see.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds who can see to Documents folders and files (#3642 piece 1, `spec/behavior/chapter-docs.md` § Who can see).

## Promotion

- **Purpose**: `chapter_document_folders.who_can_see` and `chapter_documents.who_can_see` (nullable `text[]`, checked by `chat_access_list_valid`), plus `document_access_strip_entry` triggers on `roles`, `role_tiers` and `chapter_groups` that take a deleted entry off every list, and `rename_document_folder` / `delete_document_folder`, which rename or delete a folder and move its documents in one transaction (service role only). Existing rows stay `null`, so every folder and file stays visible to everyone, as before.
- **Checks**: `select count(*) from chapter_document_folders where who_can_see is not null;` and the same on `chapter_documents` both answer 0 right after the push; `select tgname from pg_trigger where tgname like '%strip_document_access';` lists three triggers; `select proname from pg_proc where proname in ('rename_document_folder', 'delete_document_folder');` lists both functions.
- **Promoter notes**: Additive and writes no rows, so push it before the API that reads the columns and calls the functions (an older API ignores both). No manual steps.

## Rollback

Not worth reverting while no list is set: the columns are `null` everywhere and the old API ignores them. To undo, a forward migration drops the triggers, the functions and the columns, after the API that calls the folder functions is rolled back (it renames and deletes folders through them). Any list an officer set is then lost, which re-opens those files to the whole chapter, so check the counts above first ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
drop trigger if exists roles_strip_document_access on public.roles;
drop trigger if exists role_tiers_strip_document_access on public.role_tiers;
drop trigger if exists chapter_groups_strip_document_access on public.chapter_groups;
drop function if exists public.document_access_strip_entry();
drop function if exists public.rename_document_folder(uuid, uuid, text);
drop function if exists public.delete_document_folder(uuid, uuid);
alter table public.chapter_documents drop column if exists who_can_see;
alter table public.chapter_document_folders drop column if exists who_can_see;
```
