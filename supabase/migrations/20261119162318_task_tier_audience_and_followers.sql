-- A task for a tier, and a group that follows a task (#5473; Shawn,
-- 2026-11-18: "assign tasks not only as an individual but as a group… then
-- everyone in the executive board has access to it").
-- spec/behavior/tasks.md § Tasks for everyone, § Following a task.
--
-- 1. A group task (`task_groups`) and a task up for grabs (`open_tasks`) can
--    now go to a tier: every active member holding a role in it, each with a
--    copy, or one of them to claim. Same `target_id` / `scope_id` columns.
-- 2. `tasks.followed_by`: a tier, role or group the task is "from", spelled
--    as channel access lists spell an entry (`tier:<id>`, `role:<id>`,
--    `group:<id>`, `@repo/validation` channel-access-lists). Its members, read
--    live by the API, can read the task and its progress and get its finished
--    and overdue pushes. It grants nothing else: Confirm and Send back stay
--    with `tasks:manage`. Null (every existing task) is followed by nobody.
-- 3. `create_task_group` writes the follower on every copy in its one
--    transaction.
--
-- Read and written only by the API (service role), as `tasks` is.

-- 1. A tier as an audience ----------------------------------------------------

alter table public.task_groups
  drop constraint if exists task_groups_audience_check;

alter table public.task_groups
  add constraint task_groups_audience_check
  check (audience in ('everyone', 'people', 'role', 'group', 'tier'));

alter table public.task_groups
  drop constraint if exists task_groups_target_check;

alter table public.task_groups
  add constraint task_groups_target_check
  check (audience not in ('role', 'group', 'tier') or target_id is not null);

alter table public.open_tasks
  drop constraint if exists open_tasks_scope_check;

alter table public.open_tasks
  add constraint open_tasks_scope_check
  check (scope in ('chapter', 'role', 'group', 'people', 'tier'));

alter table public.open_tasks
  drop constraint if exists open_tasks_scope_target_check;

alter table public.open_tasks
  add constraint open_tasks_scope_target_check
  check (scope not in ('role', 'group', 'tier') or scope_id is not null);

-- 2. Who follows a task -------------------------------------------------------

-- Nullable with no default, so adding it rewrites no row.
alter table public.tasks
  add column if not exists followed_by text;

alter table public.tasks
  drop constraint if exists tasks_followed_by_check;

-- The entry's shape only; the API checks it names a row of the chapter.
alter table public.tasks
  add constraint tasks_followed_by_check
  check (
    followed_by is null
    or followed_by ~ '^(tier|role|group):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  );

-- A follower's board reads "my tasks, or tasks my groups follow".
create index if not exists idx_tasks_followed_by
  on public.tasks (chapter_id, followed_by)
  where followed_by is not null;

-- 3. create_task_group carries the follower ----------------------------------

drop function if exists public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[], uuid, text);

-- Same body as 20261118043407, plus the follower on every copy. Trailing with
-- a default so an API revision still running during a deploy (named args
-- without it) resolves to this function.
create or replace function public.create_task_group(
  p_chapter_id uuid,
  p_created_by uuid,
  p_audience text,
  p_assignee_ids uuid[],
  p_title text,
  p_description text,
  p_due_date date,
  p_due_at timestamptz,
  p_point_reward int,
  p_proof_kind text,
  p_subtask_titles text[],
  p_target_id uuid default null,
  p_target_name text default null,
  p_followed_by text default null
)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_group_id uuid;
begin
  if coalesce(array_length(p_assignee_ids, 1), 0) = 0 then
    raise exception 'a group task needs at least one member';
  end if;

  insert into public.task_groups (
    chapter_id, created_by, audience, target_id, target_name
  )
  values (p_chapter_id, p_created_by, p_audience, p_target_id, p_target_name)
  returning id into v_group_id;

  insert into public.tasks (
    chapter_id, title, description, assignee_id, created_by, due_date,
    due_at, status, point_reward, points_awarded, proof_kind, group_id,
    followed_by
  )
  select p_chapter_id, p_title, p_description, a.assignee_id, p_created_by,
         p_due_date, p_due_at, 'TODO', p_point_reward, false, p_proof_kind,
         v_group_id, p_followed_by
    from (select distinct unnest(p_assignee_ids) as assignee_id) a;

  insert into public.task_subtasks (task_id, chapter_id, title, position)
  select c.id, c.chapter_id, t.title, (t.ord - 1)::int
    from public.tasks c
   cross join unnest(coalesce(p_subtask_titles, '{}'))
         with ordinality as t(title, ord)
   where c.group_id = v_group_id;

  return query
    select * from public.tasks
     where group_id = v_group_id
     order by created_at, id;
end;
$$;

revoke execute on function public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[], uuid, text, text) from public;

do $$
declare
  v_fn text := 'public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[], uuid, text, text)';
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute format('revoke execute on function %s from anon', v_fn);
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute format('revoke execute on function %s from authenticated', v_fn);
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute format('grant execute on function %s to service_role', v_fn);
  end if;
end $$;
