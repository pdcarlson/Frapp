-- Study zones drawn on a map (#2239).
--
-- An officer now draws a zone as a circle (center + radius) or traces an
-- outline, instead of typing lat, lng pairs. Containment is still checked
-- against `coordinates`, the polygon every reader already understands (study
-- sessions on the server, nothing on the phone). For a circle the API writes
-- that polygon itself from `circle`; this column only remembers that the zone
-- was a circle, so the editor reopens it as one with its radius instead of as
-- 64 corners.
--
-- Additive only: one nullable column, no default, no existing row touched.
-- Every zone written before this is an outline (null), which is what it was.

alter table study_geofences
  add column if not exists circle jsonb;

alter table study_geofences
  drop constraint if exists study_geofences_circle_shape;

alter table study_geofences
  add constraint study_geofences_circle_shape check (
    circle is null
    or (
      jsonb_typeof(circle) = 'object'
      and jsonb_typeof(circle -> 'lat') = 'number'
      and jsonb_typeof(circle -> 'lng') = 'number'
      and jsonb_typeof(circle -> 'radius_m') = 'number'
    )
  );

comment on column study_geofences.circle is
  'Set when the zone was drawn as a circle: {lat, lng, radius_m}. The API derives coordinates from it; null means coordinates is an outline the officer traced.';
