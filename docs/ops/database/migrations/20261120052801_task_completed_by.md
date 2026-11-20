# 20261120052801_task_completed_by.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `tasks.completed_by`, who marked a task done, so the task screen and its History can name them (#5732).

## Promotion

- **Purpose**: a nullable `completed_by uuid` on `public.tasks`, referencing `public.users(id)` on delete set null. Mark done sets it; a take-back, send-back or reassign clears it. Existing rows stay null and read as the assignee's completion.
- **Checks**: `select column_name, is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'completed_by';` returns one row, `YES`.
- **Promoter notes**: additive and nullable, so it goes before the API. The API that writes it fails Mark done without it, so promote the migration first. Writes no data.

## Rollback

Not needed for an additive nullable column; if it must go, revert the API first (it writes the column), then a forward migration drops it.

```sql
alter table public.tasks drop column if exists completed_by;
```
