-- Meetings marked "No minutes" (Paul, 2026-11-20: "can I say we don't have
-- minutes? should be a valid option"; `spec/behavior/meetings.md`
-- § Meetings, tied to their events).
--
-- WHAT CHANGES
--
-- 1. `meeting_no_minutes`: one row per event an officer marked as having no
--    minutes, so the Meetings list stops asking for them. RLS on and no
--    policies: the API reads and writes it with the service role, gated on
--    `meetings:record`.
--
-- 2. Starting minutes on a marked event drops its mark (a trigger on
--    `meetings` insert), so minutes always win over the mark.
--
-- Locks. The foreign keys take SHARE ROW EXCLUSIVE on `events`, `chapters`
-- and `users`, and the trigger one on `meetings`, until commit; nothing is
-- rewritten.

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_no_minutes (
  event_id uuid primary key references public.events(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  marked_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.meeting_no_minutes enable row level security;

create index if not exists idx_meeting_no_minutes_chapter
  on public.meeting_no_minutes (chapter_id);
create index if not exists idx_meeting_no_minutes_marked_by
  on public.meeting_no_minutes (marked_by);

comment on table public.meeting_no_minutes is
  'Meetings an officer marked as having no minutes, so the Meetings list stops asking. Gone once minutes start. See 20261120060110_meeting_no_minutes.sql.';

-- 2. ------------------------------------------------------------------------

create or replace function public.meeting_no_minutes_drop_on_start()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_no_minutes where event_id = new.event_id;
  return new;
end;
$$;

revoke execute on function public.meeting_no_minutes_drop_on_start()
  from public, anon, authenticated;

drop trigger if exists meetings_drop_no_minutes_on_start on public.meetings;
create trigger meetings_drop_no_minutes_on_start
  after insert or update of event_id on public.meetings
  for each row
  when (new.event_id is not null)
  execute function public.meeting_no_minutes_drop_on_start();
