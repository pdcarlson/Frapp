-- One Google Drive file added to Documents by its link (#5434).
--
-- spec/behavior/chapter-docs.md § Google Drive file by link owns the rule. A
-- member who may upload pastes a Drive file's link; the API copies the file
-- into the documents bucket, files it as a chapter document, and checks Drive
-- about every 15 minutes, copying it again when it changed there.
--
-- 1. `chapter_drive_links`: one row per linked document, for the API's
--    worker: the Drive file id (and its resource key, which some older files
--    shared by link need), whether the chapter proved the file is its own
--    (`proven`; a file added because anyone with the link could open it
--    stops syncing once that ends, so a file later shared with Frapp by
--    someone else never flows in), when it is next due, its lease, and the
--    last error. Deleting the document deletes its link. One link per Drive file
--    per chapter. RLS on and no policies: API only (service role).
-- 2. `chapter_documents` gains `drive_link_status` (null on an upload or a
--    folder copy; `active`, or `no_access` once Google answers that Frapp
--    can't see the file any more) and `drive_synced_at` (when the copy last
--    matched Drive), which the document list shows. Neither feeds Frapp AI's
--    index: the corpus trigger watches title, storage path and type, which a
--    re-copy changes.
-- 3. `claim_chapter_drive_links`: the links the worker takes next, leased so
--    that several API instances never copy one file at once. A claimed link
--    is next due in 15 minutes.
--
-- Locks. The foreign keys add triggers to `chapters`, `users` and
-- `chapter_documents`; the new columns on `chapter_documents` are nullable
-- without defaults, a catalog change only. No rows are written. Safe to apply
-- twice.

-- 1. ------------------------------------------------------------------------

create table if not exists public.chapter_drive_links (
  id uuid primary key default gen_random_uuid(),
  chapter_id uuid not null references chapters(id) on delete cascade,
  document_id uuid not null references chapter_documents(id) on delete cascade,
  file_id text not null,
  resource_key text,
  linked_by uuid not null references users(id),
  proven boolean not null default false,
  sync_due_at timestamptz not null default now() + interval '15 minutes',
  sync_lease_until timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

create unique index if not exists chapter_drive_links_one_per_document
  on public.chapter_drive_links (document_id);

create unique index if not exists chapter_drive_links_one_per_file
  on public.chapter_drive_links (chapter_id, file_id);

create index if not exists chapter_drive_links_due
  on public.chapter_drive_links (sync_due_at);

alter table public.chapter_drive_links enable row level security;

-- 2. ------------------------------------------------------------------------

alter table public.chapter_documents
  add column if not exists drive_link_status text,
  add column if not exists drive_synced_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'chapter_documents_drive_link_status_check'
  ) then
    alter table public.chapter_documents
      add constraint chapter_documents_drive_link_status_check
      check (drive_link_status in ('active', 'no_access')) not valid;
  end if;
end;
$$;

-- 3. ------------------------------------------------------------------------

create or replace function public.claim_chapter_drive_links(
  p_now timestamptz,
  p_limit integer,
  p_lease_seconds integer
)
returns setof public.chapter_drive_links
language sql
security invoker
set search_path = public, pg_temp
as $$
  with due as (
    select l.id
      from public.chapter_drive_links l
     where (l.sync_lease_until is null or l.sync_lease_until <= p_now)
       and l.sync_due_at <= p_now
     order by l.sync_due_at
     limit greatest(p_limit, 0)
       for update skip locked
  )
  update public.chapter_drive_links l
     set sync_lease_until = p_now + make_interval(secs => p_lease_seconds),
         sync_due_at = p_now + interval '15 minutes'
    from due
   where l.id = due.id
  returning l.*;
$$;

revoke execute on function public.claim_chapter_drive_links(timestamptz, integer, integer)
  from public, anon, authenticated;
