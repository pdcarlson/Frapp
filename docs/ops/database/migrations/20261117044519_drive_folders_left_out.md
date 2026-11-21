# 20261117044519_drive_folders_left_out.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Counts the folders a Google Drive sync pass couldn't read, so the Google Drive panel says so (#5331, `spec/behavior/chapter-docs.md` § Google Drive folder).

## Promotion

- **Purpose**: `chapter_drive_connections.folders_left_out` (`integer not null default 0`) holds how many folders the last finished pass left unread because they sat past the depth cap or the folder cap. Existing rows read 0 until their next pass.
- **Checks**: `select column_name, column_default from information_schema.columns where table_name = 'chapter_drive_connections' and column_name = 'folders_left_out';` returns one row with default `0`.
- **Promoter notes**: Additive with a constant default, so no table rewrite and no backfill. Push it before the API that writes the column; an older API ignores it. No manual steps.

## Rollback

Not worth reverting on its own: an older API ignores the column. To undo, roll back the API first (the newer one writes the column on every pass), then run the forward migration below ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
alter table public.chapter_drive_connections drop column if exists folders_left_out;
```
