-- Repeating tasks (#5119, step 4 of #4295; Paul 2026-11-11, Shawn picked
-- "one copy at a time" 2026-11-15). spec/behavior/tasks.md § Repeating tasks.
--
-- A series is a template plus a rule in the event rule format
-- (`packages/validation/src/recurrence.ts`, open-ended allowed). Each time it
-- comes round is an ordinary `tasks` row (a copy) with its own due, status,
-- proof, sign-off and points, confirmed through `confirm_task_completion` as
-- any task is. Only the next upcoming copy exists: once the latest copy's due
-- moment passes, the API's 5-minute sweep makes the following one, done or
-- not. Stepping the rule is the API's (TypeScript, shared with the clients);
-- these functions only write what it computed, atomically.
--
--   task_series.first_due_date  the day the rule counts from (its first copy,
--     or the copy an officer changed the rule on). COUNT counts from here.
--   task_series.next_due_date   the day of the next copy still to be made.
--   task_series.latest_due_at   when the latest copy is due (the end of its
--     day in the rule's zone for an untimed copy): the sweep's trigger.
--   task_series.due_time        the copies' time of day on the rule's wall
--     clock; null for copies due by the end of the day.
--   task_series.ended_at        set when the rule runs out, an officer ends
--     the series, or its assignee leaves the chapter.
--
-- Reference photos are not copied: `task_photos.storage_path` is unique, so
-- a copy can't share another's object.
--
-- Read and written only by the API (service role), like `tasks`, so RLS is
-- on with no policies.

create table if not exists public.task_series (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  created_by uuid not null references public.users(id),
  title text not null,
  description text,
  assignee_id uuid not null references public.users(id),
  point_reward int,
  proof_kind text not null default 'none'
    check (proof_kind in ('none', 'photo', 'link')),
  subtask_titles text[] not null default '{}'
    check (coalesce(array_length(subtask_titles, 1), 0) <= 20),
  due_time time,
  recurrence_rule text not null check (char_length(recurrence_rule) <= 200),
  first_due_date date not null,
  next_due_date date not null,
  latest_due_at timestamptz not null,
  made_count int not null default 0,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_series_chapter
  on public.task_series (chapter_id);

-- The sweep's read: live series whose latest copy is due.
create index if not exists idx_task_series_live_due
  on public.task_series (latest_due_at)
  where ended_at is null;

alter table public.task_series enable row level security;

-- Nullable with no default, so adding them rewrites no row. A copy outlives
-- its series' row (set null), as a record.
alter table public.tasks
  add column if not exists series_id uuid
    references public.task_series(id) on delete set null,
  add column if not exists occurrence_date date;

-- One copy per series and day: what keeps the sweep idempotent when several
-- API instances run it at once. Plain tasks (null series) never collide.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'tasks_series_occurrence_key'
  ) then
    alter table public.tasks
      add constraint tasks_series_occurrence_key
      unique (series_id, occurrence_date);
  end if;
end $$;

-- Copies of the series' template, with its checklist. Shared by the two
-- writers below so a copy is made one way.
create or replace function public.insert_task_series_copy(
  p_series public.task_series,
  p_occurrence_date date,
  p_due_at timestamptz
)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_task public.tasks;
begin
  insert into public.tasks (
    chapter_id, title, description, assignee_id, created_by, due_date, due_at,
    status, point_reward, points_awarded, proof_kind, series_id,
    occurrence_date
  )
  values (
    p_series.chapter_id, p_series.title, p_series.description,
    p_series.assignee_id, p_series.created_by, p_occurrence_date, p_due_at,
    'TODO', p_series.point_reward, false, p_series.proof_kind, p_series.id,
    p_occurrence_date
  )
  on conflict (series_id, occurrence_date) do nothing
  returning * into v_task;

  if v_task.id is null then
    return;
  end if;

  insert into public.task_subtasks (task_id, chapter_id, title, position)
  select v_task.id, v_task.chapter_id, t.title, (t.ord - 1)::int
    from unnest(p_series.subtask_titles) with ordinality as t(title, ord);

  return next v_task;
end;
$$;

-- A new series and its first copy in one transaction, so a failure leaves
-- neither. Returns the first copy.
create or replace function public.create_task_series(
  p_chapter_id uuid,
  p_created_by uuid,
  p_title text,
  p_description text,
  p_assignee_id uuid,
  p_point_reward int,
  p_proof_kind text,
  p_subtask_titles text[],
  p_due_time time,
  p_recurrence_rule text,
  p_first_due_date date,
  p_first_due_at timestamptz,
  p_latest_due_at timestamptz,
  p_next_due_date date
)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_series public.task_series;
begin
  insert into public.task_series (
    chapter_id, created_by, title, description, assignee_id, point_reward,
    proof_kind, subtask_titles, due_time, recurrence_rule, first_due_date,
    next_due_date, latest_due_at, made_count
  )
  values (
    p_chapter_id, p_created_by, p_title, p_description, p_assignee_id,
    p_point_reward, p_proof_kind, coalesce(p_subtask_titles, '{}'), p_due_time,
    p_recurrence_rule, p_first_due_date, p_next_due_date, p_latest_due_at, 1
  )
  returning * into v_series;

  return query
    select * from public.insert_task_series_copy(
      v_series, p_first_due_date, p_first_due_at
    );
end;
$$;

-- The sweep's write: make the copy due on `p_occurrence_date` and move the
-- series on, only while the series is live and still holds the
-- `next_due_date` and `latest_due_at` the sweep planned from
-- (compare-and-set under a row lock, so two instances racing make one copy,
-- and an officer's edit of the time of day, which moves `latest_due_at`,
-- turns a plan made from the old time into a no-op). `p_next_due_date` null with `p_end` ends it after
-- this copy. Returns the new copy, or nothing when another write got there
-- first.
create or replace function public.materialize_task_series_copy(
  p_series_id uuid,
  p_expected_next date,
  p_expected_latest_due_at timestamptz,
  p_occurrence_date date,
  p_due_at timestamptz,
  p_latest_due_at timestamptz,
  p_next_due_date date,
  p_end boolean
)
returns setof public.tasks
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  v_series public.task_series;
  v_task public.tasks;
begin
  select * into v_series
    from public.task_series
   where id = p_series_id
     and ended_at is null
     and next_due_date = p_expected_next
     and latest_due_at = p_expected_latest_due_at
   for update;
  if not found then
    return;
  end if;

  select * into v_task
    from public.insert_task_series_copy(v_series, p_occurrence_date, p_due_at);

  update public.task_series
     set next_due_date = coalesce(p_next_due_date, next_due_date),
         latest_due_at = p_latest_due_at,
         made_count = made_count + case when v_task.id is null then 0 else 1 end,
         ended_at = case when p_end then now() else null end
   where id = p_series_id;

  if v_task.id is not null then
    return next v_task;
  end if;
end;
$$;

-- Written through the API's service role only; the `tasks:manage` check is
-- in the guard chain. Lock EXECUTE to it, as confirm_task_completion does.
-- The roles are absent in bare Postgres (PGlite in CI), so each is guarded.
revoke execute on function public.insert_task_series_copy(public.task_series, date, timestamptz) from public;
revoke execute on function public.create_task_series(uuid, uuid, text, text, uuid, int, text, text[], time, text, date, timestamptz, timestamptz, date) from public;
revoke execute on function public.materialize_task_series_copy(uuid, date, timestamptz, date, timestamptz, timestamptz, date, boolean) from public;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.insert_task_series_copy(public.task_series, date, timestamptz)',
    'public.create_task_series(uuid, uuid, text, text, uuid, int, text, text[], time, text, date, timestamptz, timestamptz, date)',
    'public.materialize_task_series_copy(uuid, date, timestamptz, date, timestamptz, timestamptz, date, boolean)'
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
