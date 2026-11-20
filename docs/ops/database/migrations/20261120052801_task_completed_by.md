# 20261120052801_task_completed_by.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `tasks.completed_by`, who marked a task done, so the task screen and its History can name them, and an index that lets a reopened completion delete its notification rows without a table scan (#5732).

## Promotion

- **Purpose**: a nullable `completed_by uuid` on `public.tasks`, referencing `public.users(id)` on delete set null. Mark done sets it; a take-back, send-back or reassign clears it. Existing rows stay null and read as the assignee's completion. Account deletion tombstones the users row (`anonymize_user`), so a deleted member's completions name the tombstone. Also `idx_notifications_chapter_task`, partial on `notifications` rows whose `data.target.taskId` is set, keyed on chapter and that task id, for `deleteTaskCompletionRows`.
- **Checks**: `select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'completed_by';` returns one row, `YES`; `select indexname from pg_indexes where indexname = 'idx_notifications_chapter_task';` returns one row.
- **Promoter notes**: additive and nullable, so it goes before the API. The API that writes it fails Mark done without it, so promote the migration first. Writes no data. The index builds with a plain `create index`, which locks `notifications` writes while it builds; production held 747 rows on 2026-11-20, so it is instant.

## Rollback

Not needed for an additive nullable column; if it must go, revert the API first (it writes the column), then a forward migration drops it.

```sql
drop index if exists public.idx_notifications_chapter_task;
alter table public.tasks drop column if exists completed_by;
```
