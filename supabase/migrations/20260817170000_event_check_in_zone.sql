-- Event check-in geofence (C2 of #937).
--
-- `spec/ui/mobile/patterns.md` § QR check-in is explicit that the rotating code
-- is not the anti-proxy control: "Any displayed code can be screenshotted and
-- forwarded; the check that defeats proxy check-ins is the server's zone check
-- on the scanner's location." The drawn s18 states it in-UI ("Inside the Great
-- Hall zone"). Until now `events` carried no zone at all, so that sentence
-- described a control that did not exist anywhere in the system.
--
-- Two nullable columns rather than a table: a zone belongs to exactly one event
-- and has no lifecycle of its own, so a sidecar table would buy a join and no
-- capability. Deliberately NOT reusing `study_geofences` — those rows carry
-- study-specific scoring config (`minutes_per_point`, `min_session_minutes`)
-- that means nothing for attendance, and overloading them with a second meaning
-- is the kind of debt AGENTS.md's tech-debt protocol says to avoid creating.

-- `[{"lat": <number>, "lng": <number>}, ...]`, at least 3 points, matching the
-- `study_geofences.coordinates` shape so `pointInPolygon` serves both without a
-- second coordinate format. The closing edge is implicit.
--
-- NULL means "this event has no geofence" and check-in skips the zone test.
-- That is the intended default: most chapter events do not need one, and an
-- event created before this migration must keep working unchanged. The API
-- rejects a *malformed* zone rather than treating it as absent — see
-- `isValidZone` in `apps/api/src/domain/utils/geofence.ts` — so a corrupted
-- polygon fails closed instead of silently disabling the check it encodes.
alter table public.events
  add column if not exists check_in_zone jsonb;

-- The human-readable zone name s18 renders ("Inside the Great Hall zone").
-- Stored rather than derived from `events.location`, which is free text and
-- frequently a full street address — too long for the status line, and it
-- describes where the event is, not which polygon was drawn.
alter table public.events
  add column if not exists check_in_zone_name text;

-- Shape guard at the storage layer, so a bad write cannot land even from a
-- direct SQL session that bypasses the DTO validation. Checks the JSON *shape*
-- only (an array of >= 3 objects); whether the polygon is geometrically sane is
-- the application's job, and encoding ray-casting in a CHECK constraint would
-- put a second copy of the geofence rule in SQL.
alter table public.events
  add constraint events_check_in_zone_shape check (
    check_in_zone is null or (
      jsonb_typeof(check_in_zone) = 'array'
      and jsonb_array_length(check_in_zone) >= 3
    )
  );

-- No index. The column is read only on the single-event fetch that check-in
-- already performs by primary key, and it is never a search predicate.

comment on column public.events.check_in_zone is
  'Optional check-in geofence: JSON array of {lat,lng} vertices (>= 3). NULL = no zone. See spec/ui/mobile/patterns.md.';
comment on column public.events.check_in_zone_name is
  'Human-readable name for check_in_zone, rendered on the s18 scanner status line.';
