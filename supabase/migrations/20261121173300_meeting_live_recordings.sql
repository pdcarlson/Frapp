-- Who is recording a meeting right now (Paul, 2026-11-20: show "Winston
-- Hewitt is recording"; `spec/behavior/meetings.md` § Where a draft stands).
--
-- WHAT CHANGES
--
-- `meeting_live_recordings`: one row per set of minutes a phone is recording
-- right now. The recording phone writes it when it starts and again every
-- minute while it records, and takes it away when it stops; a row not seen
-- for a few minutes (the phone died, lost signal) is read as not recording.
-- Nothing about the recording itself is kept here: the minutes, the member
-- and two times. RLS on and no policies: the API reads and writes it with the
-- service role.
--
-- Locks. The foreign keys take SHARE ROW EXCLUSIVE on `meetings`, `chapters`
-- and `users` until commit; nothing is rewritten.

create table if not exists public.meeting_live_recordings (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  seen_at timestamptz not null default now()
);

alter table public.meeting_live_recordings enable row level security;

create index if not exists idx_meeting_live_recordings_chapter
  on public.meeting_live_recordings (chapter_id);
create index if not exists idx_meeting_live_recordings_user
  on public.meeting_live_recordings (user_id);

comment on table public.meeting_live_recordings is
  'Minutes a phone is recording right now, refreshed every minute while it records, so the list can say who is recording. See 20261121173300_meeting_live_recordings.sql.';
