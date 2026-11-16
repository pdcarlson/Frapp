# 20261116201337_drive_folder_access.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets Google Drive sync keep who-can-see lists across renames and moves in Drive (#5220, `spec/behavior/chapter-docs.md` § Google Drive folder).

## Promotion

- **Purpose**: `chapter_document_folders.drive_folder_id` (nullable `text`, unique per chapter where set) ties a synced folder to its Drive folder. `chapter_drive_connections.who_can_see` (nullable `text[]`, checked by `chat_access_list_valid`) is the list a connection's top folder starts with. `chapter_documents.drive_held_folder_id` (nullable `uuid`, references `chapter_document_folders`, set null on delete) marks a Drive copy that Drive moved into a wider folder. `document_access_strip_entry` also clears a deleted role, tier or group from connections. Existing rows stay `null`.
- **Checks**: `select count(*) from chapter_document_folders where drive_folder_id is not null;` answers 0 right after the push, and `select indexname from pg_indexes where indexname = 'chapter_document_folders_drive_folder';` lists the index.
- **Promoter notes**: Additive and writes no rows, so push it before the API that reads the columns (an older API ignores them). No manual steps. No backfill: folders the earlier name-based sync made have no `drive_folder_id`, so a chapter connected before this change would get a second set of synced folders and empty old ones. Drive sync has never run in any environment (no `GOOGLE_DRIVE_CREDENTIALS_JSON` anywhere as of 2026-11-16), so there are none; if that has changed, disconnect and reconnect those chapters after the API ships.

## Rollback

Not worth reverting while Drive sync is off (no `GOOGLE_DRIVE_CREDENTIALS_JSON`): the columns stay `null`. To undo, roll back the API first, then a forward migration restores the earlier function body from `20261116185618_document_who_can_see.sql` and drops the columns, in that order and in one transaction (the current function body names `chapter_drive_connections.who_can_see`, so dropping that column first breaks deleting a role, tier or group). Synced folders then lose their tie to Drive, and the old API files copies by folder name again ([playbook](../../db-rollback-playbook.md#decision-matrix)).

With sync on, rolling back the API is itself a widening: the older API ignores who-can-see lists on connections and held copies, so its next pass refiles every held copy into the folder Drive put it in, and new synced folders start open. Disconnect Drive in each affected chapter (or unset the credential) before rolling the API back.

```sql
begin;
-- first: re-run 20261116185618's create or replace of document_access_strip_entry()
drop index if exists public.chapter_document_folders_drive_folder;
alter table public.chapter_document_folders drop column if exists drive_folder_id;
alter table public.chapter_drive_connections drop constraint if exists chapter_drive_connections_who_can_see_valid;
alter table public.chapter_drive_connections drop column if exists who_can_see;
alter table public.chapter_documents drop column if exists drive_held_folder_id;
commit;
```
