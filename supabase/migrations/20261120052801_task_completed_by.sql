-- Who marked a task done (#5732). The assignee marks their own task done, but
-- an officer can mark it done for them, so the task screen's "Moiz marked it
-- done" and History's "Marked done by Moiz" need the actor, not the assignee.
-- Set with completed_at by Mark done and cleared with it (take-back,
-- send-back, reassign). Existing completions stay null and read as the
-- assignee's. A member who is deleted leaves the completion unattributed.
alter table public.tasks
  add column if not exists completed_by uuid
    references public.users(id) on delete set null;

comment on column public.tasks.completed_by is
  'Who marked the task done (#5732): the assignee, or an officer for them. Null while open and on completions from before it was kept.';
