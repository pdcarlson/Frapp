-- Task photos (#4565): a reference photo an officer attaches to a task, a
-- proof photo the assignee attaches when marking it done, and a per-task
-- "Photo required" switch that refuses a completion without proof.
-- spec/behavior/tasks.md § Photos.
--
-- The paths are storage keys in the private `tasks` bucket below, under the
-- server-minted prefix chapters/{chapter_id}/tasks/{photo_id}/. The API
-- re-checks every path it is sent (prefix, then that the object exists) the
-- way service proof is checked, so a column value is never a client's guess.
-- Every existing task gets no photos and no requirement, which is how it
-- behaved before.
alter table public.tasks
  add column if not exists reference_photo_path text,
  add column if not exists proof_photo_path text,
  add column if not exists photo_required boolean not null default false;

-- The bucket mirrors `service` (20260803231500_service_proof_bucket.sql):
-- private, no storage RLS policies (every read and write goes through
-- API-signed URLs), and allowed_mime_types / file_size_limit pinned because a
-- signed upload URL cannot pin a content type, so these columns are the only
-- check on the upload itself. MIME types stay in lockstep with kind
-- "task_photo" in @repo/validation (packages/validation/src/upload-allowlists.ts):
-- photos only, no PDF. 26214400 = 25MB = MAX_UPLOAD_BYTES.
--
-- Guarded on storage.buckets existing, for the PGlite harness, as the service
-- bucket is; the on-conflict update makes re-applying idempotent.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
  values (
    'tasks',
    'tasks',
    false,
    array['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    26214400
  )
  on conflict (id) do update set
    public = excluded.public,
    allowed_mime_types = excluded.allowed_mime_types,
    file_size_limit = excluded.file_size_limit;
end $$;
