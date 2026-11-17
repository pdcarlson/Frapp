-- Tasks for everyone (#4295 step 3; Paul 2026-11-17 picked "one group task,
-- a copy each"). spec/behavior/tasks.md § Tasks for everyone.
--
-- A group task is one `task_groups` row naming who it went to, and one
-- ordinary `tasks` row per member (a copy) with `group_id` set. Each copy has
-- its own status, proof, send-back, sign-off and points, confirmed through
-- `confirm_task_completion` like any task; the board reads the copies back
-- as one tile ("14 of 20 done"). The API resolves the members (the chapter
-- minus its alumni); this function only writes them, atomically.
--
-- Read and written only by the API (service role), like `tasks`, so RLS is
-- on with no policies.

create table if not exists public.task_groups (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  created_by uuid not null references public.users(id),
  audience text not null default 'everyone'
    check (audience in ('everyone')),
  created_at timestamptz not null default now()
);

create index if not exists idx_task_groups_chapter
  on public.task_groups (chapter_id);

alter table public.task_groups enable row level security;

-- Nullable with no default, so adding it rewrites no row. A copy outlives its
-- group's row (set null), as a record.
alter table public.tasks
  add column if not exists group_id uuid
    references public.task_groups(id) on delete set null;

create index if not exists idx_tasks_group
  on public.tasks (group_id)
  where group_id is not null;

-- The group and a copy per member, each with the checklist, in one
-- transaction: a failure leaves none. Returns the copies.
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
  p_subtask_titles text[]
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

  insert into public.task_groups (chapter_id, created_by, audience)
  values (p_chapter_id, p_created_by, p_audience)
  returning id into v_group_id;

  insert into public.tasks (
    chapter_id, title, description, assignee_id, created_by, due_date,
    due_at, status, point_reward, points_awarded, proof_kind, group_id
  )
  select p_chapter_id, p_title, p_description, a.assignee_id, p_created_by,
         p_due_date, p_due_at, 'TODO', p_point_reward, false, p_proof_kind,
         v_group_id
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

-- Written through the API's service role only; the `tasks:manage` check is
-- in the guard chain. Lock EXECUTE to it, as create_task_series does. The
-- roles are absent in bare Postgres (PGlite in CI), so each is guarded.
revoke execute on function public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[]) from public;

do $$
declare
  v_fn text := 'public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[])';
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
