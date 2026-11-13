-- Task proof kinds and several photos (#4635). spec/behavior/tasks.md § Photos
-- and § Proof.
--
-- 1. `proof_kind` (none | photo | link) replaces #4565's `photo_required`
--    boolean: an officer sets what proof Mark done needs.
-- 2. Photos move out of the two single-path columns into `task_photos`, so a
--    task carries up to 6 reference photos and a completion up to 6 proof
--    photos (the API holds the cap of 6 per task and kind).
-- 3. `proof_link`, `sent_back_reason` and `completion_note` hold a link
--    proof, why an officer sent the completion back, and the assignee's reply.

alter table public.tasks
  add column if not exists proof_kind text not null default 'none',
  add column if not exists proof_link text,
  add column if not exists sent_back_reason text,
  add column if not exists completion_note text;

alter table public.tasks
  drop constraint if exists tasks_proof_kind_check;
alter table public.tasks
  add constraint tasks_proof_kind_check
  check (proof_kind in ('none', 'photo', 'link'));

-- Lengths the API also holds (its DTOs), so a direct write can't store more.
-- A link is http(s) only: it is shown as its domain and opened by a tap, and
-- never fetched by the server.
alter table public.tasks
  drop constraint if exists tasks_proof_link_check;
alter table public.tasks
  add constraint tasks_proof_link_check
  check (
    proof_link is null
    or (char_length(proof_link) <= 2048 and proof_link ~* '^https?://')
  );
alter table public.tasks
  drop constraint if exists tasks_sent_back_reason_check;
alter table public.tasks
  add constraint tasks_sent_back_reason_check
  check (sent_back_reason is null or char_length(sent_back_reason) <= 200);
alter table public.tasks
  drop constraint if exists tasks_completion_note_check;
alter table public.tasks
  add constraint tasks_completion_note_check
  check (completion_note is null or char_length(completion_note) <= 500);

create table if not exists public.task_photos (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  kind text not null check (kind in ('reference', 'proof')),
  -- One stored object belongs to one photo row, so deleting a task's photo
  -- never takes one another task still shows (#4565's rule, now one index).
  storage_path text not null unique,
  position integer not null default 0,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_task_photos_task
  on public.task_photos (task_id, kind, position);

-- Every read and write goes through the API's service role, like
-- task_subtasks: RLS on, no policies.
alter table public.task_photos enable row level security;

-- Backfill #4565's single photos, guarded so a re-apply after the columns
-- are gone is a no-op. The reference photo is the creator's; the proof is the
-- assignee's.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks'
      and column_name = 'reference_photo_path'
  ) then
    insert into public.task_photos
      (task_id, chapter_id, kind, storage_path, position, created_by)
    select t.id, t.chapter_id, 'reference', t.reference_photo_path, 0,
      t.created_by
    from public.tasks t
    where t.reference_photo_path is not null
    on conflict (storage_path) do nothing;

    insert into public.task_photos
      (task_id, chapter_id, kind, storage_path, position, created_by)
    select t.id, t.chapter_id, 'proof', t.proof_photo_path, 0, t.assignee_id
    from public.tasks t
    where t.proof_photo_path is not null
    on conflict (storage_path) do nothing;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'tasks'
      and column_name = 'photo_required'
  ) then
    update public.tasks set proof_kind = 'photo' where photo_required;
  end if;
end $$;

-- Decision C, applied to completions already waiting: one with no points and
-- no proof needs no sign-off, so it is Done now, with nothing paid. Without
-- this the API, which no longer confirms such a task, would leave it in the
-- officers' waiting lists for good. Idempotent: a re-apply matches nothing.
update public.tasks
set confirmed_at = coalesce(completed_at, now()),
    points_awarded = true
where status = 'COMPLETED'
  and points_awarded = false
  and coalesce(point_reward, 0) = 0
  and proof_kind = 'none';

drop index if exists public.tasks_reference_photo_path_key;
drop index if exists public.tasks_proof_photo_path_key;
alter table public.tasks
  drop column if exists reference_photo_path,
  drop column if exists proof_photo_path,
  drop column if exists photo_required;
