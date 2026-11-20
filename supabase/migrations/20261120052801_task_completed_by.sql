-- Who marked a task done (#5732). The assignee marks their own task done, but
-- an officer can mark it done for them, so the task screen's "Moiz marked it
-- done" and History's "Marked done by Moiz" need the actor, not the assignee.
-- Set with completed_at by Mark done and cleared with it (take-back,
-- send-back, reassign). Existing completions stay null, and the apps read a
-- null as the assignee's. Account deletion tombstones the users row in place
-- (anonymize_user) rather than deleting it, so a deleted member's completions
-- name the tombstone; the `on delete set null` only covers a hard delete.
alter table public.tasks
  add column if not exists completed_by uuid
    references public.users(id) on delete set null;

comment on column public.tasks.completed_by is
  'Who marked the task done (#5732): the assignee, or an officer for them. Null while open and on completions from before it was kept.';

-- Reopening a completion deletes the rows that announced it, across every
-- member of the chapter (deleteTaskCompletionRows): chapter and task id, the
-- task id read out of `data.target`. Without this the delete scans the whole
-- table, whose general indexes all lead with user_id. Partial on rows that
-- name a task, a small share of a table that holds a row per chat recipient.
-- Additive: no data change. Plain `create index`, as the other index
-- migrations here: Supabase applies each migration in a transaction, where
-- `concurrently` is refused.
create index if not exists idx_notifications_chapter_task
  on public.notifications (chapter_id, ((data -> 'target') ->> 'taskId'))
  where (data -> 'target') ->> 'taskId' is not null;
