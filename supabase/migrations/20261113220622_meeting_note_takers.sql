-- Several members take notes on one meeting (#4935, `spec/behavior/meetings.md`
-- § Several note-takers).
--
-- WHAT CHANGES
--
-- 1. `meeting_notes` holds each note-taker's own notes for one meeting's
--    unposted minutes, one row per member: the minutes' author, an officer
--    who joined, or a member the author added. A row is what makes a member a
--    note-taker. RLS on and no policies: the API reads and writes with the
--    service role and shows a note-taker only their own notes (the author and
--    `meetings:edit` holders read everyone's).
--
--      notes      the member's notes, as typed. Empty while a member the
--                 author added has written nothing yet.
--      added_by   who added them; null when they joined themselves (an
--                 officer with `meetings:record`) or are the author.
--
-- 2. `meeting_drafts.source_user_ids`: the members whose notes the draft was
--    written from, so the draft goes with any of their accounts; and
--    `meeting_drafts.sources`: what the draft was written from, each source
--    with its text and how it ranks, so the run reads exactly what was
--    asked on. Deleted with the draft.
--
-- 3. Existing drafts' notes are copied into `meeting_notes` as their author's,
--    since the notes box now reads from there.
--
-- HOW LONG THE TEXT IS KEPT (the notes rule, per person)
--
-- Only while the minutes are a draft. A row goes:
--   - with the meeting (`on delete cascade`);
--   - when the minutes are posted (trigger 4);
--   - when its member deletes their account (trigger 5), which also takes any
--     draft written from their notes;
--   - when the member clears their notes or is removed, and 30 days after it
--     was started (both in the API).
--
-- Locks. The foreign keys and the triggers below take SHARE ROW EXCLUSIVE on
-- `meetings`, `chapters` and `users` until commit, and one nullable column
-- with a constant default is added to `meeting_drafts` (no rewrite). Both
-- tables are small; milliseconds.

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_notes (
  meeting_id uuid not null references public.meetings(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  notes text not null default '',
  added_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (meeting_id, user_id),
  -- The API caps one member's notes at 160,000 characters (a two-hour
  -- transcript fits); this is the backstop.
  constraint meeting_notes_len check (char_length(notes) <= 200000)
);

alter table public.meeting_notes enable row level security;

-- The retention sweep reads by age; the account trigger by member.
create index if not exists idx_meeting_notes_created_at
  on public.meeting_notes (created_at);
create index if not exists idx_meeting_notes_user
  on public.meeting_notes (user_id);
create index if not exists idx_meeting_notes_chapter
  on public.meeting_notes (chapter_id);

comment on table public.meeting_notes is
  'Each note-taker''s own notes for one meeting''s unposted minutes. Kept only while the minutes are a draft. See 20261113220622_meeting_note_takers.sql.';

-- 2. ------------------------------------------------------------------------

alter table public.meeting_drafts
  add column if not exists source_user_ids uuid[] not null default '{}',
  add column if not exists sources jsonb not null default '[]'::jsonb;

alter table public.meeting_drafts
  drop constraint if exists meeting_drafts_sources_shape;
alter table public.meeting_drafts
  add constraint meeting_drafts_sources_shape
  check (
    jsonb_typeof(sources) = 'array'
    and pg_column_size(sources) <= 2097152
  );

comment on column public.meeting_drafts.sources is
  'What this draft was written from: each note-taker''s notes and the transcript, with how each ranks. Kept only with the draft. See 20261113220622_meeting_note_takers.sql.';

comment on column public.meeting_drafts.source_user_ids is
  'The members whose notes this draft was written from. The draft goes with any of their accounts. See 20261113220622_meeting_note_takers.sql.';

create index if not exists idx_meeting_drafts_source_user_ids
  on public.meeting_drafts using gin (source_user_ids);

-- 3. ------------------------------------------------------------------------

insert into public.meeting_notes (meeting_id, chapter_id, user_id, notes, created_at, updated_at)
select d.meeting_id, d.chapter_id, d.requested_by, d.notes, d.requested_at, d.requested_at
  from public.meeting_drafts d
  join public.meetings m on m.id = d.meeting_id
 where d.requested_by is not null
   and m.status = 'draft'
   and char_length(d.notes) <= 200000
on conflict (meeting_id, user_id) do nothing;

update public.meeting_drafts
   set source_user_ids = array[requested_by]
 where requested_by is not null
   and source_user_ids = '{}';

-- 4. ------------------------------------------------------------------------
-- Posting the minutes removes everyone's notes, as it removes the draft.

create or replace function public.meeting_notes_drop_on_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_notes where meeting_id = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_notes_drop_on_post()
  from public, anon, authenticated;

drop trigger if exists meetings_drop_notes_on_post on public.meetings;
create trigger meetings_drop_notes_on_post
  after update of status on public.meetings
  for each row
  when (new.status = 'posted' and old.status is distinct from 'posted')
  execute function public.meeting_notes_drop_on_post();

-- 5. ------------------------------------------------------------------------
-- A deleted account takes its notes with it, and every draft written from
-- them. Redefines the drafts' own trigger function (20261112180000), which
-- `users_drop_meeting_drafts` already calls.

create or replace function public.meeting_drafts_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_drafts
   where requested_by = new.id
      or new.id = any (source_user_ids);
  delete from public.meeting_notes where user_id = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_drafts_drop_for_deleted_user()
  from public, anon, authenticated;
