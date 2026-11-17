-- Re-arm an event's pre-start reminder when its start time moves (#1550).
--
-- The reminder sweep claims (EVENT, event_id, 'EVENT_REMINDER', <UTC date of
-- start_time>) in scheduled_notification_dispatches before sending. The key's
-- date component is a `date`, so an event moved within one UTC day reused its
-- claim and was never reminded about its real start: the only "starts in 30
-- minutes" push named the old time.
--
-- The fix deletes the event's EVENT_REMINDER claims whenever its start_time
-- actually changes, so the next sweep tick claims afresh for the new time.
-- Tasks already do the same from TaskService.update (`releaseReminderClaims`,
-- #5306); for events it lives here because start_time has more than one
-- writer (EventService.update, and the series edit and split paths that retime
-- the head or its successor), and a trigger is the one place none of them can
-- forget. A series edit that regenerates occurrences doesn't update them: it
-- rebuilds them under new ids, which carry no claim at all.
--
-- Deferred to the writer's commit, so the delete sees any claim a sweep tick
-- committed while the update was in flight. A tick that read the event before
-- the move and claims after the commit is the sweep's to catch: it reads
-- start_time again once it wins the claim and releases the claim if the time
-- moved (`ScheduledJobsService.notifyEventStartingSoon`).
--
-- Why not widen the claim key with the exact time: the old and new API would
-- write differently shaped claims across the deploy gap and after an API-only
-- rollback, and two shapes that don't collide send the reminder twice (#5306's
-- first attempt, dropped). This trigger changes nothing about how a claim is
-- written, so it is correct under any API version and needs no backfill.
--
-- Only EVENT_REMINDER is released. AUTO_ABSENT keys on end_time, and
-- markAutoAbsent is idempotent by construction.
--
-- security invoker, like the other data triggers on events
-- (events_mark_google_calendar_due): every writer of events is the API's
-- service role, which owns the delete. Execute is revoked from client roles.

create or replace function public.events_release_reminder_claims()
returns trigger
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
begin
  delete from public.scheduled_notification_dispatches
   where entity_type = 'EVENT'
     and entity_id = new.id
     and threshold = 'EVENT_REMINDER';
  return null;
end;
$$;

revoke execute on function public.events_release_reminder_claims()
  from public, anon, authenticated;

drop trigger if exists events_release_reminder_claims on public.events;
create constraint trigger events_release_reminder_claims
  after update of start_time on public.events
  deferrable initially deferred
  for each row
  when (old.start_time is distinct from new.start_time)
  execute function public.events_release_reminder_claims();
