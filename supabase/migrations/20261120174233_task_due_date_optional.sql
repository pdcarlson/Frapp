-- A task can have no due date (#5761, Shawn 2026-11-20: "you can just leave
-- the due date unspecified").
--
--   tasks.due_date  now nullable. Null is a task with no due date: it is never
--     overdue, gets no due reminders, and sorts after every dated task. A
--     time of day needs a day, so `due_at` must be null with it.
--
-- A repeating copy always has a day (its occurrence), and a group's copies
-- share one due date or none, so the RPCs that insert tasks pass a null
-- through unchanged and need no edit.
--
-- Dropping NOT NULL rewrites no row, and the check is validated against rows
-- that all have a due date today.

alter table public.tasks
  alter column due_date drop not null;

alter table public.tasks
  add constraint tasks_due_at_needs_due_date
  check (due_at is null or due_date is not null);
