-- Google Drive folder sync for chapter documents (#5157).
--
-- spec/behavior/chapter-docs.md § Google Drive folder owns the rule. An
-- officer shares a Google Drive folder with Frapp's service account and
-- connects it; the API copies the folder's files into the documents bucket
-- and files each as a chapter document, and keeps those copies matching the
-- folder.
--
-- 1. `chapter_drive_connections`: at most one live row per chapter. Status:
--    `active` syncs; `no_access` means Google answered that the service
--    account can no longer see the folder (unshared, or deleted), and the
--    copies stay as they were until the officer shares it again or connects
--    another; `disconnecting` means an officer disconnected, and the API
--    still has to remove the copies, then deletes the row. A disconnecting
--    row is not live, so a new folder can be connected at once (the partial
--    unique index). Counts are the last finished sync's. RLS on and no
--    policies: API only (service role).
-- 2. `chapter_documents` gains `drive_file_id`, `drive_modified_at` and
--    `drive_url`: set on a copy of a Drive file, null on an upload. One copy
--    per Drive file per chapter (the partial unique index). Drive owns a copy:
--    the API refuses to delete one.
-- 3. `claim_chapter_drive_syncs`: the connections the API's worker takes
--    next, each leased so that several API instances never sync one folder at
--    once. A claimed active or no_access row is next due in 15 minutes.
--
-- Locks. The foreign keys add triggers to `chapters` and `users`; the new
-- columns on `chapter_documents` are nullable without defaults, a catalog
-- change only, and the unique index is built on a column that is null in
-- every existing row. No rows are written. Safe to apply twice.

-- 1. ------------------------------------------------------------------------

create table if not exists public.chapter_drive_connections (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  folder_id text not null,
  folder_name text not null,
  connected_by uuid not null references users(id),
  status text not null default 'active',
  sync_due_at timestamptz not null default now(),
  sync_lease_until timestamptz,
  last_synced_at timestamptz,
  last_error text,
  synced_count integer not null default 0,
  skipped_count integer not null default 0,
  created_at timestamptz not null default now(),
  constraint chapter_drive_connections_status_check
    check (status in ('active', 'no_access', 'disconnecting'))
);

-- One row per chapter, a disconnecting one included: its cleanup removes
-- every Drive copy in the chapter, so a new folder waits until it is done.
create unique index if not exists chapter_drive_connections_one_per_chapter
  on public.chapter_drive_connections (chapter_id);

-- A folder feeds one chapter at a time.
create unique index if not exists chapter_drive_connections_one_chapter_per_folder
  on public.chapter_drive_connections (folder_id)
  where status <> 'disconnecting';

create index if not exists chapter_drive_connections_due
  on public.chapter_drive_connections (sync_due_at);

alter table public.chapter_drive_connections enable row level security;

-- 2. ------------------------------------------------------------------------

alter table public.chapter_documents
  add column if not exists drive_file_id text,
  add column if not exists drive_modified_at timestamptz,
  add column if not exists drive_url text;

create unique index if not exists chapter_documents_one_copy_per_drive_file
  on public.chapter_documents (chapter_id, drive_file_id)
  where drive_file_id is not null;

-- 3. ------------------------------------------------------------------------

create or replace function public.claim_chapter_drive_syncs(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.chapter_drive_connections
language sql
security invoker
set search_path = public, pg_temp
as $$
  with due as (
    select c.id
      from public.chapter_drive_connections c
     where (c.sync_lease_until is null or c.sync_lease_until <= p_now)
       and (c.sync_due_at <= p_now or c.status = 'disconnecting')
     order by c.sync_due_at
     limit greatest(p_limit, 0)
       for update skip locked
  )
  update public.chapter_drive_connections c
     set sync_lease_until = p_now + make_interval(secs => p_lease_seconds),
         sync_due_at = case
           when c.status = 'disconnecting' then c.sync_due_at
           else p_now + interval '15 minutes'
         end
    from due
   where c.id = due.id
  returning c.*;
$$;

revoke execute on function public.claim_chapter_drive_syncs(timestamptz, integer, integer)
  from public, anon, authenticated;
