-- Two gaps in what a deleted account takes with it (#4504 items 2 and 3).
-- Both were found by the final review of the AI build-out and matter only
-- once AI is on for a chapter.
--
-- 1. A transcript could outlive its uploader as another officer's draft.
--    Officer A uploads a recording, officer B drafts minutes from its
--    transcript, A deletes their account. The recording's row went (it is
--    A's), but B's `meeting_drafts.notes` held the same transcript until the
--    minutes posted or 30 days passed. `spec/behavior/meetings.md` says the
--    transcript goes with the uploader's account.
--
--    The transcript reaches a draft through the officer's notes box, so the
--    draft never said whose recording its notes may hold, and the
--    recording's own row is often gone first (its 30 days run from the
--    upload, the draft's from the request; an officer can remove or replace
--    the recording). So the draft now carries the uploader:
--    `meeting_drafts.recording_uploaded_by`, stamped by a trigger from the
--    meeting's recording each time a draft is requested, and kept when the
--    recording has since gone. Deleting that account deletes the draft.
--
--    This is conservative: a draft requested while a recording existed is
--    treated as holding its transcript, even if the officer typed the notes
--    by hand. They draft again. What it still misses: an officer who removes
--    the recording, keeps its transcript in the notes box and only then
--    asks for a first draft. Those are that officer's notes by then, and the
--    30-day limit still applies.
--
-- 2. A report could outlive a quoted member who deleted their account in
--    the same instant. `ai_reports.quoted_user_ids` is an array with no
--    foreign key, so the insert check and the account's delete trigger could
--    each miss the other's uncommitted change. The check now locks the
--    users it reads `for share`, which waits for an account deletion in
--    flight (and makes one that starts later wait for the report), so one of
--    the two always sees the other. `for key share` would not do: an update
--    of `deleted_at` does not conflict with it.
--
-- Locks. One nullable column with no default is added to `meeting_drafts`
-- (a catalog change, no rewrite; the table is empty until AI is on), with a
-- foreign key to `users` added `not valid` and validated in a second
-- statement, and one partial index. Two function bodies are replaced and
-- one trigger is created on `meeting_drafts`. The new `for share` holds a
-- row lock on a handful of `users` rows for the length of one report insert.
--
-- Safe to apply twice.

-- 1. ------------------------------------------------------------------------

alter table public.meeting_drafts
  add column if not exists recording_uploaded_by uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'meeting_drafts_recording_uploaded_by_fkey'
  ) then
    alter table public.meeting_drafts
      add constraint meeting_drafts_recording_uploaded_by_fkey
      foreign key (recording_uploaded_by) references public.users(id)
      on delete set null not valid;
  end if;
end;
$$;

alter table public.meeting_drafts
  validate constraint meeting_drafts_recording_uploaded_by_fkey;

create index if not exists idx_meeting_drafts_recording_uploaded_by
  on public.meeting_drafts (recording_uploaded_by)
  where recording_uploaded_by is not null;

comment on column public.meeting_drafts.recording_uploaded_by is
  'Who uploaded the recording the meeting had when this draft was requested: the notes may hold its transcript, so the draft goes with that account. Set by trigger, never by the API. See 20261112260000_ai_deleted_account_gaps.sql.';

-- Each request (an insert, or the upsert's update) takes the uploader of the
-- meeting's recording as it stands, and keeps the earlier one when the
-- recording has gone.
create or replace function public.meeting_drafts_stamp_recording_uploader()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  new.recording_uploaded_by := coalesce(
    (select r.uploaded_by
       from public.meeting_recordings r
      where r.meeting_id = new.meeting_id),
    new.recording_uploaded_by
  );
  return new;
end;
$$;

revoke execute on function public.meeting_drafts_stamp_recording_uploader()
  from public, anon, authenticated;

drop trigger if exists meeting_drafts_stamp_recording_uploader
  on public.meeting_drafts;
create trigger meeting_drafts_stamp_recording_uploader
  before insert or update of request_id, notes on public.meeting_drafts
  for each row
  execute function public.meeting_drafts_stamp_recording_uploader();

create or replace function public.meeting_recordings_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_drafts where recording_uploaded_by = new.id;
  delete from public.meeting_recordings where uploaded_by = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_recordings_drop_for_deleted_user()
  from public, anon, authenticated;

-- 2. ------------------------------------------------------------------------

create or replace function public.ai_reports_refuse_deleted_users()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  -- Ordered, so two reports quoting the same members lock them the same way.
  perform 1
    from public.users u
   where u.id = new.reported_by or u.id = any (new.quoted_user_ids)
   order by u.id
     for share;
  if exists (
    select 1
    from public.users u
    where (u.id = new.reported_by or u.id = any (new.quoted_user_ids))
      and u.deleted_at is not null
  ) then
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function public.ai_reports_refuse_deleted_users()
  from public, anon, authenticated;
