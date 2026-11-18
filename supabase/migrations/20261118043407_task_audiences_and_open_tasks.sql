-- Who a task can go to, and tasks up for grabs (Paul, 2026-11-18).
-- spec/behavior/tasks.md § Who a task goes to, § Up for grabs.
--
-- 1. A group task (`task_groups`, 20261117172708) now goes to everyone, to
--    several people the officer picked, to everyone holding a role, or to
--    everyone in a chapter group. Each still gets their own copy. The row
--    keeps the role or group it named (`target_id`) and that name as it was
--    (`target_name`), shown if the role or group is later deleted.
-- 2. `open_tasks`: one task posted for "someone" in the chapter, a role, a
--    group or a list of people. Any eligible member claims it, or an officer
--    hands it to someone; either way one ordinary task is written for that
--    member (`claim_open_task`). The assignee can give it back before they've
--    finished it (`release_open_task`), which puts the posting back up.
--
-- The API resolves who is eligible (alumni left out); these functions only
-- write, atomically. Read and written only by the API (service role), like
-- `tasks`, so RLS is on with no policies.

-- 1. Group tasks for a role, a group or several people -----------------------

alter table public.task_groups
  drop constraint if exists task_groups_audience_check;

alter table public.task_groups
  add constraint task_groups_audience_check
  check (audience in ('everyone', 'people', 'role', 'group'));

-- Nullable with no default, so adding them rewrites no row: an existing
-- group is for everyone and names no role or group.
alter table public.task_groups
  add column if not exists target_id uuid,
  add column if not exists target_name text;

alter table public.task_groups
  drop constraint if exists task_groups_target_check;

alter table public.task_groups
  add constraint task_groups_target_check
  check (audience not in ('role', 'group') or target_id is not null);

drop function if exists public.create_task_group(uuid, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[]);

-- The group and a copy per member, each with the checklist, in one
-- transaction: a failure leaves none. Returns the copies.
create or replace function public.create_task_group(
  p_chapter_id uuid,
  p_created_by uuid,
  p_audience text,
  p_target_id uuid,
  p_target_name text,
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

  insert into public.task_groups (
    chapter_id, created_by, audience, target_id, target_name
  )
  values (p_chapter_id, p_created_by, p_audience, p_target_id, p_target_name)
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

-- 2. Tasks up for grabs ------------------------------------------------------

create table if not exists public.open_tasks (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  created_by uuid not null references public.users(id),
  title text not null,
  description text,
  due_date date not null,
  due_at timestamptz,
  point_reward int,
  proof_kind text not null default 'none'
    check (proof_kind in ('none', 'photo', 'link')),
  -- The checklist the claimed task starts with, in order.
  subtask_titles text[] not null default '{}',
  -- Who may claim it: anyone in the chapter, a role's holders, a group's
  -- members, or the people listed in `scope_user_ids`.
  scope text not null default 'chapter'
    check (scope in ('chapter', 'role', 'group', 'people')),
  -- The role or group it names; its name as it was, shown once it's gone.
  scope_id uuid,
  scope_name text,
  scope_user_ids uuid[],
  status text not null default 'open'
    check (status in ('open', 'claimed')),
  -- The task claiming it made. Set null if that task is deleted: the posting
  -- stays claimed, as a record.
  claimed_task_id uuid references public.tasks(id) on delete set null,
  claimed_by uuid references public.users(id),
  claimed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint open_tasks_scope_target_check
    check (scope not in ('role', 'group') or scope_id is not null),
  constraint open_tasks_scope_people_check
    check (scope <> 'people' or coalesce(array_length(scope_user_ids, 1), 0) > 0)
);

create index if not exists idx_open_tasks_chapter_status
  on public.open_tasks (chapter_id, status);

-- "Which posting was this task claimed from", read for each task on the board.
create index if not exists idx_open_tasks_claimed_task
  on public.open_tasks (claimed_task_id)
  where claimed_task_id is not null;

alter table public.open_tasks enable row level security;

-- Claim a posting for one member (they claimed it, or an officer handed it to
-- them): the task and its checklist, and the posting marked claimed, in one
-- transaction under the posting's row lock, so two claims at once make one
-- task. Raises P0002 when the chapter has no such posting and FR409 when it
-- is no longer open (the API answers 404 and 409). Returns the task.
create or replace function public.claim_open_task(
  p_chapter_id uuid,
  p_open_task_id uuid,
  p_assignee_id uuid,
  p_created_by uuid
)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_posting public.open_tasks%rowtype;
  v_task_id uuid;
begin
  select * into v_posting
    from public.open_tasks
   where id = p_open_task_id
     and chapter_id = p_chapter_id
   for update;

  if not found then
    raise exception 'no such open task' using errcode = 'P0002';
  end if;
  if v_posting.status <> 'open' then
    raise exception 'Someone already claimed this' using errcode = 'FR409';
  end if;

  insert into public.tasks (
    chapter_id, title, description, assignee_id, created_by, due_date,
    due_at, status, point_reward, points_awarded, proof_kind
  )
  values (
    v_posting.chapter_id, v_posting.title, v_posting.description,
    p_assignee_id, coalesce(p_created_by, v_posting.created_by),
    v_posting.due_date, v_posting.due_at, 'TODO', v_posting.point_reward,
    false, v_posting.proof_kind
  )
  returning id into v_task_id;

  insert into public.task_subtasks (task_id, chapter_id, title, position)
  select v_task_id, v_posting.chapter_id, t.title, (t.ord - 1)::int
    from unnest(v_posting.subtask_titles) with ordinality as t(title, ord);

  update public.open_tasks
     set status = 'claimed',
         claimed_task_id = v_task_id,
         claimed_by = p_assignee_id,
         claimed_at = now(),
         updated_at = now()
   where id = v_posting.id;

  return query select * from public.tasks where id = v_task_id;
end;
$$;

-- Give a claimed task back: the task goes and its posting is open again, in
-- one transaction under the posting's row lock. Only the task's assignee, and
-- only before it's finished: not marked done, no points paid, no proof
-- photos. Raises P0002 when the task wasn't claimed from a posting of the
-- chapter, 42501 when the user isn't its assignee and FR409 when it's past
-- giving back (the API answers 404, 403 and 409). Returns the posting.
create or replace function public.release_open_task(
  p_chapter_id uuid,
  p_task_id uuid,
  p_user_id uuid
)
returns setof public.open_tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_posting public.open_tasks%rowtype;
  v_task public.tasks%rowtype;
begin
  select * into v_posting
    from public.open_tasks
   where claimed_task_id = p_task_id
     and chapter_id = p_chapter_id
   for update;

  if not found then
    raise exception 'this task was not claimed from Up for grabs'
      using errcode = 'P0002';
  end if;

  select * into v_task
    from public.tasks
   where id = p_task_id
     and chapter_id = p_chapter_id
   for update;

  if not found then
    raise exception 'no such task' using errcode = 'P0002';
  end if;
  if v_task.assignee_id <> p_user_id then
    raise exception 'only its assignee can give a task back'
      using errcode = '42501';
  end if;
  if v_task.status = 'COMPLETED'
     or v_task.points_awarded
     or exists (
       select 1 from public.task_photos
        where task_id = p_task_id and kind = 'proof'
     ) then
    raise exception 'this task is already done, so it can''t be given back'
      using errcode = 'FR409';
  end if;

  -- The posting first, so its foreign key isn't what clears the claim.
  update public.open_tasks
     set status = 'open',
         claimed_task_id = null,
         claimed_by = null,
         claimed_at = null,
         updated_at = now()
   where id = v_posting.id;

  delete from public.tasks where id = p_task_id;

  return query select * from public.open_tasks where id = v_posting.id;
end;
$$;

-- Written through the API's service role only; the permission checks are in
-- the guard chain and the services. Lock EXECUTE to it, as create_task_group
-- did. The roles are absent in bare Postgres (PGlite in CI), so each is
-- guarded.
revoke execute on function public.create_task_group(uuid, uuid, text, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[]) from public;
revoke execute on function public.claim_open_task(uuid, uuid, uuid, uuid) from public;
revoke execute on function public.release_open_task(uuid, uuid, uuid) from public;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.create_task_group(uuid, uuid, text, uuid, text, uuid[], text, text, date, timestamptz, int, text, text[])',
    'public.claim_open_task(uuid, uuid, uuid, uuid)',
    'public.release_open_task(uuid, uuid, uuid)'
  ] loop
    if exists (select 1 from pg_roles where rolname = 'anon') then
      execute format('revoke execute on function %s from anon', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'authenticated') then
      execute format('revoke execute on function %s from authenticated', v_fn);
    end if;
    if exists (select 1 from pg_roles where rolname = 'service_role') then
      execute format('grant execute on function %s to service_role', v_fn);
    end if;
  end loop;
end $$;
