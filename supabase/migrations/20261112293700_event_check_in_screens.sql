-- Check in near the QR screen (#4532).
--
-- An officer shows the rotating check-in code from their phone (mobile s22).
-- While it is on screen, the phone reports where it is about once a minute,
-- and a member's check-in passes when their phone is within 100 yards of
-- that spot (plus both phones' reported accuracy, capped). So the room is the
-- zone, and an officer no longer has to draw one per event. A drawn
-- `events.check_in_zone` still wins when an event has one.
--
-- One row per officer showing the code for an event (two doors, two
-- phones). A member passes when they are near any of them that knows where it
-- is. Each phone's report replaces its own row, location included, so a phone
-- carried to another room moves its anchor with it, and one that loses its
-- fix (location refused, or accuracy worse than 100 m) stops anchoring
-- anything rather than leaving its old spot behind. A row also means "the QR
-- is in use for this event", which makes the code required for the rest of
-- the check-in window (a forwarded screenshot goes stale in one rotation, and
-- a member texted the code from across campus fails the distance check).
-- When no live row has a location, the code is still required and the
-- distance isn't checked.
--
-- Privacy: the location is kept only while the event's check-in is open.
-- `expires_at` is the window's close, the API ignores a row past it, and a
-- sweep deletes it within 10 minutes (`CheckInScreenSweepService`). No
-- policies: only the API, on the service-role path, reads or writes it.
--
-- Rollback: `drop table if exists public.event_check_in_screens;` Check-in
-- goes back to the drawn zone alone; nothing else reads the table.

create table if not exists public.event_check_in_screens (
  event_id uuid not null references public.events(id) on delete cascade,
  reported_by uuid not null references public.users(id) on delete cascade,
  chapter_id uuid not null references public.chapters(id) on delete cascade,
  lat double precision,
  lng double precision,
  accuracy_m double precision,
  located_at timestamptz,
  shown_at timestamptz not null default now(),
  expires_at timestamptz not null,
  -- A location is all four fields or none of them.
  constraint event_check_in_screens_location_whole check (
    (lat is null) = (lng is null)
    and (lat is null) = (accuracy_m is null)
    and (lat is null) = (located_at is null)
  ),
  constraint event_check_in_screens_lat_range
    check (lat is null or lat between -90 and 90),
  constraint event_check_in_screens_lng_range
    check (lng is null or lng between -180 and 180),
  -- The API stores no location less precise than 100 m (it would anchor the
  -- room in the wrong place), so a larger value is a bug, not a reading.
  constraint event_check_in_screens_accuracy_range
    check (accuracy_m is null or (accuracy_m > 0 and accuracy_m <= 100)),
  constraint event_check_in_screens_pkey primary key (event_id, reported_by)
);

create index if not exists event_check_in_screens_expires_at
  on public.event_check_in_screens (expires_at);

create index if not exists event_check_in_screens_chapter
  on public.event_check_in_screens (chapter_id);

create index if not exists event_check_in_screens_reported_by
  on public.event_check_in_screens (reported_by);

alter table public.event_check_in_screens enable row level security;

comment on table public.event_check_in_screens is
  'Where an event''s check-in QR screen is (#4532): one row per officer showing it, kept only until check-in closes. API only. See 20261112293700_event_check_in_screens.sql.';
