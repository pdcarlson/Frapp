-- Posted minutes keep their recording's transcript (#5410, Paul 2026-11-17:
-- "it should store the transcript ... and we should be able to query that
-- transcript with the AI"). Until now posting deleted the recording's row,
-- transcript and all (20261112210000_meeting_recordings.sql). The row still
-- goes, and its audio with it; the transcript moves onto the minutes first.

alter table public.meetings
  add column if not exists transcript text;

comment on column public.meetings.transcript is
  'The recording''s transcript, copied from meeting_recordings when the minutes are posted. Read with the minutes and indexed for Ask. See 20261117195822_meetings_keep_transcript.sql.';

-- Before the status changes, so the copy is in the same row write as the
-- posting; the AFTER trigger meetings_drop_recording_on_post then deletes
-- the recording's row.
create or replace function public.meetings_keep_transcript_on_post()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  select r.transcript
    into new.transcript
    from public.meeting_recordings r
   where r.meeting_id = new.id
     and r.status = 'ready'
     and r.transcript is not null;
  if not found then
    new.transcript := old.transcript;
  end if;
  return new;
end;
$$;

revoke execute on function public.meetings_keep_transcript_on_post()
  from public, anon, authenticated;

drop trigger if exists meetings_keep_transcript_on_post on public.meetings;
create trigger meetings_keep_transcript_on_post
  before update of status on public.meetings
  for each row
  when (new.status = 'posted' and old.status is distinct from 'posted')
  execute function public.meetings_keep_transcript_on_post();

comment on table public.meeting_recordings is
  'One meeting''s uploaded recording: where its upload and transcription stand, and the transcript. The audio is kept for playback until the minutes are posted; posting copies the transcript onto meetings.transcript and removes this row. See 20261112210000_meeting_recordings.sql and 20261117195822_meetings_keep_transcript.sql.';
