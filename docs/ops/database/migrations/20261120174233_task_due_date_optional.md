# 20261120174233_task_due_date_optional.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Makes `tasks.due_date` nullable, so a task can have no due date (#5761), and adds a check that a task with a time of day (`due_at`) also has a day.

## Promotion

- **Purpose**: `tasks.due_date` drops `NOT NULL`; the new check `tasks_due_at_needs_due_date` refuses `due_at` without `due_date`.
- **Checks**: `select is_nullable from information_schema.columns where table_schema = 'public' and table_name = 'tasks' and column_name = 'due_date';` returns `YES`, and `select conname from pg_constraint where conname = 'tasks_due_at_needs_due_date';` returns one row.
- **Promoter notes**: push before the API that writes a null due date. Writes no data. Phone builds already shipped read an undated task without crashing (they list it under Later with no date; checked in the PR for #5761), so promoting this ahead of a phone release is safe.

## Rollback

Worth it only if undated tasks must go away. Restoring `NOT NULL` fails while any undated task exists, so give those a day first (here, the day they were created) or delete them.

```sql
update public.tasks set due_date = created_at::date where due_date is null;
alter table public.tasks drop constraint if exists tasks_due_at_needs_due_date;
alter table public.tasks alter column due_date set not null;
```
