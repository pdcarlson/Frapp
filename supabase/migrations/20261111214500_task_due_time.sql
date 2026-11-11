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
