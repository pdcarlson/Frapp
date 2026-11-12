-- A meeting's uploaded recording and its transcript (#712, ADR-28 decisions 6
-- and 7, `spec/behavior/meetings.md` § Uploading a recording).
--
-- WHAT CHANGES
--
-- 1. `meeting-audio`, a private storage bucket that holds a recording only
--    from the moment it is uploaded until its transcript is written.
-- 2. `meeting_recordings`, one row per meeting: where its upload and its
--    transcription stand, and the transcript once there is one.
-- 3. The AI spend ledger learns about audio: `ai_usage_events.audio_seconds`,
--    AssemblyAI as a provider, and `settle_ai_spend` / `ai_chapter_usage`
--    carrying the seconds.
-- 4. `meeting_drafts.notes` may hold a two-hour transcript.
--
-- Nothing here turns anything on: the API offers an upload only when
-- `AI_ENABLED` is on, a transcription provider is configured and the
-- chapter's president has switched meeting notes on.

-- 1. ------------------------------------------------------------------------
-- The bucket. Private with no storage RLS policies, as every bucket here:
-- the officer's browser uploads through an API-issued signed upload URL
-- (resumable, `/storage/v1/upload/resumable/sign`), and the only reader is
-- the API, which signs a short link for the transcription provider.
--
-- Object layout: {chapter_id}/{meeting_id}/{upload_id}.{ext}
--
-- 209715200 = 200MB = MAX_MEETING_RECORDING_BYTES in @repo/validation, and
-- the MIME list is MEETING_RECORDING_MIME_TYPES there. As on every bucket,
-- the list gates the type the uploader declares, never the bytes.
--
-- The hosted projects' own project-level upload limit is 100MB and caps every
-- bucket (20261106153000_backwork_bucket_100mb.sql). Until it is raised in
-- the dashboard, a recording over 100MB is refused by storage when its upload
-- starts. `supabase/config.toml`'s local cap is raised in the same change.
--
-- Guarded on storage.buckets existing: the PGlite harness replays migrations
-- into bare Postgres, which has no storage schema.
do $$
begin
  if to_regclass('storage.buckets') is null then
    return;
  end if;

  insert into storage.buckets (id, name, public, allowed_mime_types, file_size_limit)
  values (
    'meeting-audio',
    'meeting-audio',
    false,
    array[
      'audio/mp4',
      'audio/x-m4a',
      'audio/m4a',
      'audio/mpeg',
      'audio/mp3',
      'audio/wav',
      'audio/x-wav',
      'audio/wave',
      'audio/aac',
      'audio/ogg',
      'audio/opus',
      'audio/webm',
      'audio/flac',
      'audio/x-flac'
    ],
    209715200
  )
  on conflict (id) do update
    set public = excluded.public,
        allowed_mime_types = excluded.allowed_mime_types,
        file_size_limit = excluded.file_size_limit;
end $$;

-- 2. ------------------------------------------------------------------------
-- `meeting_recordings`: at most one row per meeting; uploading again replaces
-- it. RLS on and no policies: the API reads and writes with the service role,
-- and shows a row only to whoever may edit the meeting's minutes.
--
--   upload_id              a fresh id per upload. The AI run (`ai_runs`,
--                          which holds ids only) carries it, so a run that
--                          finishes after the officer uploaded again, or
--                          removed the recording, writes nothing.
--   storage_path           where the audio is in `meeting-audio`, while it
--                          may still be there. Null once the API has deleted
--                          it: when the transcript is written, when the
--                          transcription fails for good, or when the officer
--                          removes the recording. A sweep in the API deletes
--                          any object this column does not name.
--   file_name              the file's own name, shown back to the officer.
--   duration_seconds       what the officer's browser read off the file,
--                          then what the provider measured.
--   notice_confirmed_at    when the officer confirmed the room was told it
--                          was being recorded (§ Recording notice). An upload
--                          is refused without it.
--   attendees_notified_at  when Frapp told the members who were at the
--                          meeting. Kept across a replaced upload, so they
--                          are told once per meeting.
--   status                 uploading, transcribing, ready, or failed.
--   failure_code           why, as a `MeetingRecordingFailure`
--                          (`@repo/validation`).
--   run_id                 the run doing the work. `on delete set null`.
--   provider_job_id        the provider's id for the transcription while it
--                          is in progress, so a second try resumes it.
--   transcript             the transcript, one line per speaker turn. The
--                          only place it is stored until the officer drafts
--                          from it, when it also becomes the draft's notes.
--   speaker_count          how many voices the provider told apart. Labels
--                          are per recording; no voiceprint is kept.
--
-- HOW LONG THINGS ARE KEPT (`spec/behavior/meetings.md` § Retention)
--
-- The audio: minutes. It is deleted as soon as the transcript is written or
-- the transcription has failed for good, and never outlives the row.
--
-- The transcript: as the officer's notes are, only while the minutes are a
-- draft. The row goes:
--   - with the meeting (`on delete cascade`);
--   - when the minutes are posted (trigger below);
--   - when the officer who uploaded it deletes their account (trigger below);
--   - when the officer removes the recording (the web's Clear notes does), and 30
--     days after the upload whatever else happened (both in the API).
--
-- Locks. The foreign keys add triggers to `meetings`, `chapters`, `users`
-- and `ai_runs`, and the two triggers below are created on `meetings` and
-- `users`, each taking a SHARE ROW EXCLUSIVE lock until commit: writes to
-- those four tables wait for the file to commit. The table is new and empty,
-- so that is milliseconds.

create table if not exists public.meeting_recordings (
  meeting_id uuid primary key references public.meetings(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  upload_id uuid not null,
  uploaded_by uuid references public.users(id) on delete set null,
  storage_path text,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,
  duration_seconds integer not null,
  notice_confirmed_at timestamptz not null,
  attendees_notified_at timestamptz,
  status text not null default 'uploading',
  failure_code text,
  run_id uuid references public.ai_runs(id) on delete set null,
  provider_job_id text,
  transcript text,
  speaker_count integer,
  created_at timestamptz not null default now(),
  finished_at timestamptz,
  constraint meeting_recordings_status_allowed
    check (status in ('uploading', 'transcribing', 'ready', 'failed')),
  constraint meeting_recordings_failure_matches_status
    check ((status = 'failed') = (failure_code is not null)),
  constraint meeting_recordings_failure_code_len
    check (failure_code is null or char_length(failure_code) between 1 and 40),
  -- A transcript exists exactly when the recording is ready.
  constraint meeting_recordings_transcript_matches_status
    check ((status = 'ready') = (transcript is not null)),
  -- MEETING_NOTES_MAX_LENGTH is 160,000; this is the backstop.
  constraint meeting_recordings_transcript_len
    check (transcript is null or char_length(transcript) <= 200000),
  constraint meeting_recordings_file_name_len
    check (char_length(file_name) between 1 and 200),
  constraint meeting_recordings_mime_type_len
    check (char_length(mime_type) between 1 and 100),
  constraint meeting_recordings_storage_path_len
    check (storage_path is null or char_length(storage_path) between 1 and 300),
  constraint meeting_recordings_provider_job_len
    check (provider_job_id is null or char_length(provider_job_id) between 1 and 200),
  -- 200MB and two hours are the API's limits; these are the backstops.
  constraint meeting_recordings_size
    check (size_bytes between 1 and 209715200),
  constraint meeting_recordings_duration
    check (duration_seconds between 1 and 36000),
  constraint meeting_recordings_speaker_count
    check (speaker_count is null or speaker_count >= 0)
);

alter table public.meeting_recordings enable row level security;

-- The retention sweep reads by age, and the audio sweep reads the rows that
-- may still have a file.
create index if not exists idx_meeting_recordings_created_at
  on public.meeting_recordings (created_at);
create index if not exists idx_meeting_recordings_with_audio
  on public.meeting_recordings (created_at)
  where storage_path is not null;
create index if not exists idx_meeting_recordings_uploaded_by
  on public.meeting_recordings (uploaded_by)
  where uploaded_by is not null;

comment on table public.meeting_recordings is
  'One meeting''s uploaded recording: where its upload and transcription stand, and the transcript. The audio lives in the meeting-audio bucket only until the transcript is written; the row is kept only while the minutes are a draft. See 20261112200000_meeting_recordings.sql.';

-- Posting the minutes removes the recording's row and its transcript, as it
-- removes the notes (20261112180000_meeting_drafts.sql). Any audio still in
-- the bucket is then named by no row, and the API's sweep deletes it.
create or replace function public.meeting_recordings_drop_on_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_recordings where meeting_id = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_recordings_drop_on_post()
  from public, anon, authenticated;

drop trigger if exists meetings_drop_recording_on_post on public.meetings;
create trigger meetings_drop_recording_on_post
  after update of status on public.meetings
  for each row
  when (new.status = 'posted' and old.status is distinct from 'posted')
  execute function public.meeting_recordings_drop_on_post();

-- A deleted account takes the recording it uploaded, and its transcript,
-- with it. A trigger on `users.deleted_at`, which `anonymize_user` sets, as
-- `users_drop_meeting_drafts` is: `anonymize_user` is not redefined here.
create or replace function public.meeting_recordings_drop_for_deleted_user()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.meeting_recordings where uploaded_by = new.id;
  return new;
end;
$$;

revoke execute on function public.meeting_recordings_drop_for_deleted_user()
  from public, anon, authenticated;

drop trigger if exists users_drop_meeting_recordings on public.users;
create trigger users_drop_meeting_recordings
  after update of deleted_at on public.users
  for each row
  when (new.deleted_at is not null and old.deleted_at is null)
  execute function public.meeting_recordings_drop_for_deleted_user();

-- 3. ------------------------------------------------------------------------
-- The spend ledger and audio (`spec/behavior/billing.md`: "Transcription
-- seconds arrive with transcription (#712)").
--
-- `audio_seconds` is how much audio a transcription call was billed for; it
-- is zero on every other call. Adding a column with a constant default
-- rewrites nothing.
alter table public.ai_usage_events
  add column if not exists audio_seconds integer not null default 0;

-- The two checks below are added NOT VALID and validated in a second
-- statement, so the table is not held under ACCESS EXCLUSIVE while its rows
-- are read. `ai_usage_events` has no rows anywhere AI has not been switched
-- on, which is everywhere.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_audio_seconds_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_audio_seconds_check
  check (audio_seconds >= 0) not valid;
alter table public.ai_usage_events
  validate constraint ai_usage_events_audio_seconds_check;

-- AssemblyAI joins the providers a call may be recorded against. The old
-- check was written inline, so it carries Postgres's default name.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_provider_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_provider_check
  check (provider in ('anthropic', 'google', 'assemblyai', 'scripted')) not valid;
alter table public.ai_usage_events
  validate constraint ai_usage_events_provider_check;

-- `settle_ai_spend` gains `p_audio_seconds`, last and with a default, so a
-- caller that does not pass it (every token call, and an API process from
-- before this migration) still resolves to this one function. A parameter
-- cannot be added with `create or replace`, so the old signature is dropped
-- first, in the same transaction. The body is 20261112130000's with the one
-- column added.
drop function if exists public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz);

create or replace function public.settle_ai_spend(
  p_reservation_id uuid,
  p_chapter_id uuid,
  p_user_id uuid,
  p_run_id uuid,
  p_task text,
  p_family text,
  p_provider text,
  p_model text,
  p_prompt_version text,
  p_outcome text,
  p_error_kind text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cached_input_tokens integer,
  p_cost_micro_usd bigint,
  p_bill_reservation boolean,
  p_latency_ms integer,
  p_now timestamptz,
  p_audio_seconds integer default 0
)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
begin
  if p_reservation_id is null then
    insert into public.ai_usage_events (
      chapter_id, user_id, run_id, task, family, provider, model, prompt_version,
      status, outcome, error_kind, input_tokens, output_tokens, cached_input_tokens,
      audio_seconds, reserved_cost_micro_usd, cost_micro_usd, latency_ms,
      created_at, settled_at
    )
    values (
      p_chapter_id, p_user_id, p_run_id, p_task, p_family, p_provider, p_model,
      p_prompt_version, 'settled', p_outcome, p_error_kind, p_input_tokens,
      p_output_tokens, p_cached_input_tokens, coalesce(p_audio_seconds, 0), 0,
      p_cost_micro_usd, p_latency_ms, p_now, p_now
    );
    return 'inserted';
  end if;

  update public.ai_usage_events e
     set status = 'settled',
         outcome = p_outcome,
         error_kind = p_error_kind,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cached_input_tokens = p_cached_input_tokens,
         audio_seconds = coalesce(p_audio_seconds, 0),
         cost_micro_usd = case
           when p_bill_reservation then e.reserved_cost_micro_usd
           else p_cost_micro_usd
         end,
         cost_estimated = coalesce(p_bill_reservation, false),
         latency_ms = p_latency_ms,
         settled_at = p_now
   where e.id = p_reservation_id
     and e.chapter_id = p_chapter_id
     and e.status in ('reserved', 'expired');

  if found then
    return 'settled';
  end if;
  return 'missing';
end;
$$;

comment on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz, integer) is
  'Settles an AI spend hold with the call''s real counts and cost (or charges the hold itself when the provider never reported usage), or records a call made with no hold. p_audio_seconds is the audio a transcription was billed for. Returns settled, inserted or missing. See 20261112130000_ai_usage_ledger.sql and 20261112200000_meeting_recordings.sql.';

-- `ai_chapter_usage` returns the seconds too. A function's return columns
-- cannot change with `create or replace` either. The body is 20261112130000's
-- with the one sum added.
drop function if exists public.ai_chapter_usage(uuid, timestamptz, timestamptz);

create or replace function public.ai_chapter_usage(
  p_chapter_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  task text,
  provider text,
  model text,
  calls bigint,
  input_tokens bigint,
  output_tokens bigint,
  cached_input_tokens bigint,
  audio_seconds bigint,
  cost_micro_usd bigint,
  estimated_cost_micro_usd bigint,
  unsettled_calls bigint
)
language sql
stable
security invoker
set search_path = ''
as $$
  select e.task,
         e.provider,
         e.model,
         count(*)::bigint,
         coalesce(sum(e.input_tokens), 0)::bigint,
         coalesce(sum(e.output_tokens), 0)::bigint,
         coalesce(sum(e.cached_input_tokens), 0)::bigint,
         coalesce(sum(e.audio_seconds), 0)::bigint,
         coalesce(sum(public.ai_usage_charge(e.status, e.reserved_cost_micro_usd, e.cost_micro_usd)), 0)::bigint,
         coalesce(sum(
           case when e.status <> 'settled' or e.cost_estimated
             then public.ai_usage_charge(e.status, e.reserved_cost_micro_usd, e.cost_micro_usd)
             else 0 end
         ), 0)::bigint,
         count(*) filter (where e.status <> 'settled')::bigint
    from public.ai_usage_events e
   where e.chapter_id = p_chapter_id
     and e.created_at >= p_from
     and e.created_at < p_to
   group by e.task, e.provider, e.model
   order by e.task, e.provider, e.model;
$$;

comment on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) is
  'A chapter''s AI usage in [p_from, p_to), one row per task, provider and model: calls, token counts, seconds of audio transcribed, cost in micro-USD (holds count at their hold), the part of it that is estimated, and calls not yet settled. See 20261112130000_ai_usage_ledger.sql.';

-- Service role only, as every RPC the API alone calls. Dropping a function
-- drops its grants, so both are revoked again.
revoke execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz, integer) from public;
revoke execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) from public;

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    revoke execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz, integer) from anon;
    revoke execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) from anon;
  end if;
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    revoke execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz, integer) from authenticated;
    revoke execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) from authenticated;
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    grant execute on function public.settle_ai_spend(uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, integer, integer, integer, bigint, boolean, integer, timestamptz, integer) to service_role;
    grant execute on function public.ai_chapter_usage(uuid, timestamptz, timestamptz) to service_role;
  end if;
end $$;

-- 4. ------------------------------------------------------------------------
-- An officer's notes may now be the transcript of a two-hour recording, which
-- is about 120,000 characters with its speaker labels. The API's limit
-- (MEETING_NOTES_MAX_LENGTH) rises from 40,000 to 160,000, and this backstop
-- from 50,000 to 200,000. Widening a check invalidates no row, so it is
-- added NOT VALID and validated after, as above.
alter table public.meeting_drafts
  drop constraint if exists meeting_drafts_notes_len;
alter table public.meeting_drafts
  add constraint meeting_drafts_notes_len
  check (char_length(notes) between 1 and 200000) not valid;
alter table public.meeting_drafts
  validate constraint meeting_drafts_notes_len;
