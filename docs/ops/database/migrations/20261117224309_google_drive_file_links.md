# 20261117224309_google_drive_file_links.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

One Google Drive file added to Documents by its link, kept matching Drive (#5434, `spec/behavior/chapter-docs.md` § Google Drive file by link).

## Promotion

- **Purpose**: `chapter_drive_links` holds one row per linked document for the API's worker (Drive file id, resource key, whether the chapter proved the file is its own, due time, lease, last error); deleting the document deletes it. `chapter_documents` gains `drive_link_status` (`active` / `no_access`, null for anything not linked, checked `not valid` so the add touches no rows) and `drive_synced_at`. `claim_chapter_drive_links` leases due links to the worker.
- **Checks**: `select count(*) from public.chapter_drive_links;` returns 0. `select proname from pg_proc where proname = 'claim_chapter_drive_links';` returns one row. `select column_name from information_schema.columns where table_name = 'chapter_documents' and column_name in ('drive_link_status', 'drive_synced_at');` returns two rows.
- **Promoter notes**: Additive, no backfill. Push it before the API from the same PR: a deploy applies migrations first, and that API reads the new columns on every document list. An older API ignores them. The foreign keys take `SHARE ROW EXCLUSIVE` on `chapters`, `users` and `chapter_documents`, and the column adds take `ACCESS EXCLUSIVE` on `chapter_documents`, each for a catalog change that touches no rows. Idempotent. Nothing is offered to members until Drive is set up (`GOOGLE_DRIVE_SERVICE_ACCOUNT`, [`integrations.md`](../../deployment/integrations.md) § 7C).

## Rollback

Roll back the API first: the newer one reads the columns on every document list. Linked documents then stay as ordinary documents that no longer sync. Then run the forward migration below ([playbook](../../db-rollback-playbook.md#decision-matrix)). An older API refuses to delete a document with a `drive_file_id`, so clear the linked rows' Drive id first, which leaves them as plain uploads.

```sql
update public.chapter_documents set drive_file_id = null, drive_modified_at = null
 where drive_link_status is not null;
drop function if exists public.claim_chapter_drive_links(timestamptz, integer, integer);
drop table if exists public.chapter_drive_links;
alter table public.chapter_documents
  drop constraint if exists chapter_documents_drive_link_status_check,
  drop column if exists drive_link_status,
  drop column if exists drive_synced_at;
```
