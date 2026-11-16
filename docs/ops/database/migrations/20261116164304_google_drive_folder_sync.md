# 20261116164304_google_drive_folder_sync.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the table, columns and claim function behind connecting a chapter's Google Drive folder to Documents, where Frapp copies the folder's files into the library and keeps them matching it (#5157). The rule is [`spec/behavior/chapter-docs.md` § Google Drive folder](../../../../spec/behavior/chapter-docs.md#google-drive-folder).

## Promotion

- **Purpose**: `chapter_drive_connections` (at most one live row per chapter: the Drive folder's id and name, who connected it, `status` `active` / `no_access` / `disconnecting`, the sync schedule and lease, and the last sync's counts and error), cascading with the chapter, RLS on, no policies (API only, service role). `chapter_documents` gains nullable `drive_file_id`, `drive_modified_at` and `drive_url`, with a partial unique index on `(chapter_id, drive_file_id)`. `claim_chapter_drive_syncs(p_now, p_limit, p_lease_seconds)` leases due and disconnecting connections to the API's worker (an active or no_access one is next due 15 minutes later); execute revoked from `public`, `anon` and `authenticated`. No existing row changes.
- **Checks**: After `db push`, `select relrowsecurity from pg_class where relname = 'chapter_drive_connections';` returns `true`, `select count(*) from pg_policies where tablename = 'chapter_drive_connections';` returns `0`, `select count(*) from information_schema.columns where table_name = 'chapter_documents' and column_name in ('drive_file_id', 'drive_modified_at', 'drive_url');` returns `3`, and `select * from claim_chapter_drive_syncs(now(), 1, 60);` returns no rows.
- **Promoter notes**: Ship it before, or with, the API from the same PR; a deploy applies migrations first. The older API never reads the new table or columns. The newer API against an unmigrated database fails the `/v1/google-drive` routes and the document list (500). The foreign keys take `SHARE ROW EXCLUSIVE` on `chapters` and `users`, and the column adds take `ACCESS EXCLUSIVE` on `chapter_documents`, each for a catalog change that touches no rows. Idempotent. No data written, nothing by hand. Nothing is offered to members until `GOOGLE_DRIVE_CREDENTIALS_JSON` is set ([`integrations.md` § 7C. Google Drive folder](../../deployment/integrations.md#7c-google-drive-folder)).

## Rollback

Revert the API forward and keep the migration file ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). The reverted API stops syncing: copies already filed stay in Documents as ordinary documents, frozen, and can be deleted by hand. Keep the schema unless it is the problem. To remove it all, after the code revert has shipped and once the copies are deleted or kept on purpose, in a later forward migration:

```sql
drop function if exists public.claim_chapter_drive_syncs(timestamptz, integer, integer);
drop index if exists public.chapter_documents_one_copy_per_drive_file;
alter table public.chapter_documents
  drop column if exists drive_url,
  drop column if exists drive_modified_at,
  drop column if exists drive_file_id;
drop table if exists public.chapter_drive_connections;
```
