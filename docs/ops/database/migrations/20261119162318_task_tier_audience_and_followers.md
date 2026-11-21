# 20261119162318_task_tier_audience_and_followers.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets a group task and a task up for grabs go to a tier (`task_groups.audience` and `open_tasks.scope` gain `tier`), adds `tasks.followed_by`, the tier, role or group a task is from, and replaces `create_task_group` with a version that writes it on every copy (#5473; `spec/behavior/tasks.md` § Tasks for everyone, § Following a task).

## Promotion

- **Purpose**: an officer can give a task to everyone holding a role in a tier ("Exec board"), a copy each, or post one for one of them to claim; and can mark a task as from a tier, role or group, whose members can then read it and hear when it's finished or overdue. Every existing row is followed by nobody (`followed_by` null). No row is rewritten.
- **Checks**:
  - `select count(*) from public.tasks where followed_by is not null;` returns 0 right after promotion.
  - `select pg_get_constraintdef(oid) from pg_constraint where conname in ('task_groups_audience_check', 'open_tasks_scope_check');` lists `tier` in both.
  - `select count(*) from pg_proc where proname = 'create_task_group';` returns 1 (the old signature is gone).
  - `select has_function_privilege('authenticated', 'public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[], uuid, text, text)', 'execute');` returns false.
- **Promoter notes**: promote before the API that sends `p_followed_by`. The new `create_task_group` keeps every earlier parameter and adds `p_followed_by` last with `default null`, so an API from before this change still resolves it by name while the deploy rolls. Everything else is additive.

## Rollback

Worth it only if the migration itself breaks something. Roll the API back first, then run this as a forward migration ([playbook](../../db-rollback-playbook.md#decision-matrix)). Who follows each task is lost; the tasks stay. A group or posting for a tier would fail the restored checks, so those fold into `everyone` / `chapter` first (each copy is still an ordinary task for its member; a posting for a tier becomes claimable by anyone).

```sql
drop function if exists public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[], uuid, text, text);
drop index if exists public.idx_tasks_followed_by;
alter table public.tasks drop constraint if exists tasks_followed_by_check;
alter table public.tasks drop column if exists followed_by;
update public.task_groups set audience = 'everyone', target_id = null where audience = 'tier';
alter table public.task_groups drop constraint if exists task_groups_audience_check;
alter table public.task_groups add constraint task_groups_audience_check check (audience in ('everyone', 'people', 'role', 'group'));
alter table public.task_groups drop constraint if exists task_groups_target_check;
alter table public.task_groups add constraint task_groups_target_check check (audience not in ('role', 'group') or target_id is not null);
update public.open_tasks set scope = 'chapter', scope_id = null where scope = 'tier';
alter table public.open_tasks drop constraint if exists open_tasks_scope_check;
alter table public.open_tasks add constraint open_tasks_scope_check check (scope in ('chapter', 'role', 'group', 'people'));
alter table public.open_tasks drop constraint if exists open_tasks_scope_target_check;
alter table public.open_tasks add constraint open_tasks_scope_target_check check (scope not in ('role', 'group') or scope_id is not null);
-- Then restore create_task_group's earlier signature from
-- supabase/migrations/20261118043407_task_audiences_and_open_tasks.sql.
```
