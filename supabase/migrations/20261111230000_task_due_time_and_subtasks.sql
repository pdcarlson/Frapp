-- A task can be due at a time of day, not only on a day (#4003, Paul
-- 2026-11-10: "I'd like to also be able to set a time of day they're due").
--
--   tasks.due_at  the exact moment the task is due. Null for a task due on a
--     day with no time, which is every task before this and any task created
--     without a time: it behaves exactly as before, overdue from the day
--     after `due_date` and reminded at the daily sweep.
--
-- A timestamp rather than a time of day, because chapters keep no zone of
-- their own: the creator's device turns "Fri 5 PM" into an instant, the same
-- way an event's start is stored. `due_date` stays required and still names
-- the calendar day as the creator saw it, so every reader that groups or
-- sorts by day (the boards, the chat card, the calendar) keeps working
-- without knowing about times.
--
-- Nullable with no default, so adding it rewrites no row.

alter table public.tasks
  add column if not exists due_at timestamptz;

-- Subtasks: a short checklist under a task (#4003, Paul: "and add
-- subtasks"). Each is a line the assignee ticks off, and the task shows how
-- many are done ("2 of 5"). They carry no assignee, due date or points of
-- their own: the task's assignee owns them and the task's points pay for
-- them, which keeps one person accountable for one award. Who else can be
-- handed part of a chore is assigning a task to a role (#3661).
--
--   task_subtasks.title     what to do, 1 to 200 characters.
--   task_subtasks.position  order under the task, 0 first.
--   task_subtasks.done_at   when it was ticked; null while it is still to do.
--
-- `chapter_id` is carried so every read and write is scoped to the chapter
-- the way the API scopes `tasks`, and both foreign keys cascade: deleting a
-- task, or a chapter, takes its subtasks with it. Read and written only by
-- the API (service role), so RLS is on with no policies.

create table if not exists public.task_subtasks (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  title text not null check (char_length(btrim(title)) between 1 and 200),
  position integer not null default 0,
  done_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_subtasks_task
  on public.task_subtasks (task_id, position);

alter table public.task_subtasks enable row level security;
