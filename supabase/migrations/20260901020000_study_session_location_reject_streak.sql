-- #313: enforce the GPS-accuracy path spec/behavior/study-sessions.md specifies
-- but the server never implemented -- "if the user's GPS is spoofed or
-- unreliable (accuracy > 100m), the heartbeat is rejected and the session is
-- flagged. After 2 consecutive rejected heartbeats, the session is expired
-- with status LOCATION_INVALID." Today the heartbeat DTO has no accuracy
-- field at all, and the out-of-polygon path sets LOCATION_INVALID immediately
-- on the first miss -- the wrong status per spec, which reserves
-- LOCATION_INVALID for this counter and calls for an immediate EXPIRED on an
-- out-of-polygon fix.
--
-- Additive only: one new column with a safe default. No existing column,
-- constraint, index, or policy is altered, and no row is deleted.
--
-- Nullable is deliberately avoided in favor of a `not null default 0`: every
-- existing in-flight session has by construction zero consecutive rejected
-- accuracy heartbeats recorded against it (the column didn't exist to record
-- any), so 0 is not a placeholder -- it is the correct pre-migration state.

alter table study_sessions
  add column if not exists location_reject_streak int not null default 0;

comment on column study_sessions.location_reject_streak is
  'Consecutive heartbeats rejected for GPS accuracy > 100m. Reset to 0 on any accepted heartbeat; reaching 2 expires the session as LOCATION_INVALID. Distinct from an out-of-polygon miss, which expires the session immediately as EXPIRED.';
