# 20261118043407_task_audiences_and_open_tasks.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Widens group tasks to several people, a role's holders or a group's members (`task_groups.audience` gains `people`, `role` and `group`, plus `target_id` and `target_name`), replaces `create_task_group` with a version that takes the target, and adds tasks up for grabs: the `open_tasks` table and the service-role functions `claim_open_task` and `release_open_task` (Paul, 2026-11-18; `spec/behavior/tasks.md` § Tasks for everyone, § Up for grabs).

## Promotion

- **Purpose**: an officer can give a task to everyone in a role or group, or to several people (a copy each), or post one task that any eligible member claims. Existing group rows keep `audience = 'everyone'` with null targets and behave as before. No row is rewritten.
- **Checks**:
  - `select count(*) from public.open_tasks;` returns 0 right after promotion.
  - `select pg_get_constraintdef(oid) from pg_constraint where conname = 'task_groups_audience_check';` lists `everyone`, `people`, `role` and `group`.
  - `select has_function_privilege('authenticated', 'public.claim_open_task(uuid, uuid, uuid, uuid)', 'execute');` returns false, and the same for `public.release_open_task(uuid, uuid, uuid)` and `public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[], uuid, text)`.
  - `select count(*) from pg_proc where proname = 'create_task_group';` returns 1 (the old signature is gone).
- **Promoter notes**: promote before the API that sends `p_target_id` and `p_target_name`. The new `create_task_group` keeps every earlier parameter in place and adds those two last with `default null`, so an API from before this change still resolves it by name while the deploy rolls. The new API can't create a role or group task until this is applied. Everything else is additive.

## Rollback

Worth it only if the migration itself breaks something. Roll the API back first, then run this as a forward migration ([playbook](../../db-rollback-playbook.md#decision-matrix)). Postings still open are lost; tasks already claimed from them stay as ordinary tasks. A group row for a role, a group or several people would fail the restored check, so those are folded into `everyone` first (each copy is still an ordinary task for its member).

```sql
drop function if exists public.release_open_task(uuid, uuid, uuid);
drop function if exists public.claim_open_task(uuid, uuid, uuid, uuid);
drop table if exists public.open_tasks;
drop function if exists public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[], uuid, text);
update public.task_groups set audience = 'everyone' where audience <> 'everyone';
alter table public.task_groups drop constraint if exists task_groups_target_check;
alter table public.task_groups drop constraint if exists task_groups_audience_check;
alter table public.task_groups add constraint task_groups_audience_check check (audience in ('everyone'));
alter table public.task_groups drop column if exists target_name, drop column if exists target_id;
-- Then restore create_task_group's earlier signature from
-- supabase/migrations/20261117172708_task_groups.sql.
```
