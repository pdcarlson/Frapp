-- How many minutes before an event's start its check-in opens (#3703).
--
-- Check-in used to open at start_time exactly. Members arrive early: at a
-- real chapter meeting forty of them walked in during the same five minutes
-- before the start and were told check-in hadn't opened. The window now opens
-- check_in_opens_minutes before start_time and still closes 15 minutes after
-- end_time (spec/behavior/events.md § Check-In). An officer sets it per event
-- under the event's More options.
--
-- Not null with a default of 10, so every existing event, including today's,
-- opens ten minutes early from the deploy on. That is the intended change,
-- not a side effect: the old zero-minute window is what the issue reports as
-- wrong. The bound mirrors MAX_CHECK_IN_OPENS_MINUTES in @repo/validation.

alter table public.events
  add column if not exists check_in_opens_minutes integer not null default 10;

alter table public.events
  drop constraint if exists events_check_in_opens_minutes_range;

alter table public.events
  add constraint events_check_in_opens_minutes_range
  check (check_in_opens_minutes between 0 and 120);

comment on column public.events.check_in_opens_minutes is
  'Minutes before start_time that check-in opens (0-120, default 10). The window closes 15 minutes after end_time.';
