# 20261117224309_google_drive_file_links.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

One Google Drive file added to Documents by its link, kept matching Drive (#5434, `spec/behavior/chapter-docs.md` § Google Drive file by link).

## Promotion

- **Purpose**: `chapter_drive_links` holds one row per linked document for the API's worker (Drive file id, resource key, whether the chapter proved the file is its own, due time, lease, last error); deleting the document deletes it. `chapter_documents` gains `drive_link_status` (`active` / `no_access`, null for anything not linked, checked `not valid` so the add touches no rows) and `drive_synced_at`. `claim_chapter_drive_links` leases due links to the worker.
- **Checks**: `select count(*) from public.chapter_drive_links;` returns 0. `select proname from pg_proc where proname = 'claim_chapter_drive_links';` returns one row. `select column_name from information_schema.columns where table_name = 'chapter_documents' and column_name in ('drive_link_status', 'drive_synced_at');` returns two rows.
- **Promoter notes**: Additive, no backfill. Push it before the API from the same PR: a deploy applies migrations first, and that API reads the new columns on every document list. An older API doesn't read them, but its folder sync takes any document with a `drive_file_id` for a folder copy, so it would delete a linked file in a chapter with a connected folder; linked files only exist once the newer API is out, and Drive is off everywhere as of 2026-11-17, so a normal rollout never meets that. The foreign keys take `SHARE ROW EXCLUSIVE` on `chapters`, `users` and `chapter_documents`, and the column adds take `ACCESS EXCLUSIVE` on `chapter_documents`, each for a catalog change that touches no rows. Idempotent. Nothing is offered to members until Drive is set up ([`integrations.md`](../../deployment/integrations.md) § 7C: `GOOGLE_DRIVE_SERVICE_ACCOUNT` on Cloud Run since #5439, or a `GOOGLE_DRIVE_CREDENTIALS_JSON` key file).

## Rollback

Order matters, or linked files are deleted. **First**, while the newer API still runs, turn every linked document into a plain upload: an older API's folder sync takes any row with a `drive_file_id` for a folder copy and deletes it, row and stored file, when it isn't in the connected folder. The newer API is fine with it (a cleared row no longer syncs).

```sql
update public.chapter_documents
   set drive_file_id = null, drive_modified_at = null, drive_url = null
 where drive_link_status is not null;
```

**Then** roll back the API, and **last** run the forward migration below ([playbook](../../db-rollback-playbook.md#decision-matrix)). The documents stay, as ordinary uploads that no longer follow Drive.

```sql
drop function if exists public.claim_chapter_drive_links(timestamptz, integer, integer);
drop table if exists public.chapter_drive_links;
alter table public.chapter_documents
  drop constraint if exists chapter_documents_drive_link_status_check,
  drop column if exists drive_link_status,
  drop column if exists drive_synced_at;
```
