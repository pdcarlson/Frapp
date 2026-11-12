-- Minutes drafted from an officer's notes (#4312, ADR-28 decision 6).
--
-- WHAT CHANGES
--
-- `meeting_drafts` holds one meeting's draft-from-notes request: the notes
-- the officer pasted, where the AI run stands, and what it wrote. At most one
-- row per meeting; asking again replaces it. RLS on and no policies: the API
-- reads and writes with the service role, and shows a row only to whoever may
-- edit the meeting's minutes.
--
--   request_id       a fresh id per request. The AI run (`ai_runs`, which
--                    holds ids only) carries it, so a run that finishes after
--                    the officer asked again writes nothing.
--   run_id           the run doing the work. `on delete set null`: pruning
--                    old runs never removes a draft.
--   notes            the officer's notes. This is the only place they are
--                    stored.
--   meeting_date     the meeting's calendar day where the officer is, so
--                    "by Friday" in the notes resolves to the right date.
--   base_updated_at  the minutes' `updated_at` when the draft was asked for.
--                    The draft goes into the minutes only while they are
--                    still at that version, so it never overwrites a save.
--   status           drafting, ready (written, but the minutes moved on, so
--                    the officer chooses to use it), applied, or failed.
--   failure_code     why, as a `MeetingDraftFailure` (`@repo/validation`).
--   result           `{ content, review }`. `review` is what the officer
--                    checks the draft against: what the notes leave out, and
--                    the line each decision and action item came from.
--                    `content`, the drafted sections, is kept only while the
--                    draft waits (`ready`); once it is in the minutes the row
--                    holds `review` alone.
--
-- HOW LONG THE TEXT IS KEPT (`spec/behavior/meetings.md` § Drafting from
-- notes, `spec/behavior/ai.md` § Stored AI text)
--
-- Only while the minutes are a draft. The row goes:
--   - with the meeting (`on delete cascade`);
--   - when the minutes are posted (trigger 2 below), so posted minutes keep
--     no copy of the rough notes;
--   - when the officer who asked deletes their account (trigger 3 below);
--   - when the officer clears their notes, and 30 days after the request
--     whatever else happened (both in the API).
--
-- Locks. The foreign keys add triggers to `meetings`, `chapters`, `users`
-- and `ai_runs`, and triggers 2 and 3 are created on `meetings` and `users`,
-- each taking a SHARE ROW EXCLUSIVE lock until commit: writes to those four
-- tables wait for the file to commit. The table is new and empty, so that is
-- milliseconds.

-- 1. ------------------------------------------------------------------------

create table if not exists public.meeting_drafts (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  request_id uuid not null,
  run_id uuid references public.ai_runs(id) on delete set null,
  requested_by uuid references public.users(id) on delete set null,
  notes text not null,
  meeting_date date not null,
  base_updated_at timestamptz not null,
  status text not null default 'drafting',
  failure_code text,
  result jsonb,
  requested_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint meeting_drafts_status_allowed
    check (status in ('drafting', 'ready', 'applied', 'failed')),
  -- The API caps notes at 40,000 characters; this is the backstop.
  constraint meeting_drafts_notes_len
    check (char_length(notes) between 1 and 50000),
  constraint meeting_drafts_failure_matches_status
    check ((status = 'failed') = (failure_code is not null)),
  constraint meeting_drafts_failure_code_len
    check (failure_code is null or char_length(failure_code) between 1 and 40),
  constraint meeting_drafts_result_is_object
    check (result is null or jsonb_typeof(result) = 'object'),
  constraint meeting_drafts_result_size
    check (result is null or pg_column_size(result) <= 1048576)
);

alter table public.meeting_drafts enable row level security;

-- The retention sweep reads by age.
create index if not exists idx_meeting_drafts_requested_at
  on public.meeting_drafts (requested_at);

comment on table public.meeting_drafts is
  'One meeting''s draft-from-notes request: the officer''s notes, the AI run, and what it wrote. Kept only while the minutes are a draft. See 20261112180000_meeting_drafts.sql.';

-- 2. ------------------------------------------------------------------------
-- Posting the minutes removes the notes and the draft they produced.

create or replace function public.meeting_drafts_drop_on_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_drafts where meeting_id = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_drafts_drop_on_post()
  from public, anon, authenticated;

drop trigger if exists meetings_drop_draft_on_post on public.meetings;
create trigger meetings_drop_draft_on_post
  after update of status on public.meetings
  for each row
  when (new.status = 'posted' and old.status is distinct from 'posted')
  execute function public.meeting_drafts_drop_on_post();

-- 3. ------------------------------------------------------------------------
-- A deleted account takes the notes it pasted with it. `anonymize_user` sets
-- `users.deleted_at`; a trigger here rather than another redefinition of that
-- function, which several AI changes would otherwise each have to carry.

create or replace function public.meeting_drafts_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_drafts where requested_by = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_drafts_drop_for_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_drop_meeting_drafts on public.users;
create trigger users_drop_meeting_drafts
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.meeting_drafts_drop_for_deleted_user();

create index if not exists idx_meeting_drafts_requested_by
  on public.meeting_drafts (requested_by)
  where requested_by is not null;
