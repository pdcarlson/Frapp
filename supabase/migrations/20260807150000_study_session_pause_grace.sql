-- FRA-232: server-owned pause + grace window for study sessions.
--
-- `spec/behavior/study-sessions.md` requires that backgrounding a study session
-- pauses the timer, and that failing to return within a chapter-configurable
-- grace window auto-expires the session as PAUSED_EXPIRED, awarding points only
-- for foreground time accumulated before the pause. The status value has
-- existed in the CHECK constraint since the initial schema, but nothing on the
-- server could ever assign it: there was no pause signal and no grace setting.
-- Clients paused their heartbeat locally and told the server nothing, so
-- background time was credited as foreground time.
--
-- Additive only: two new columns, both with safe defaults. No existing column,
-- constraint, index, or policy is altered, and no row is deleted. The
-- PAUSED_EXPIRED status is already permitted by the existing status CHECK, so
-- that constraint needs no change either.

alter table study_geofences
  add column if not exists pause_grace_minutes int not null default 5;

comment on column study_geofences.pause_grace_minutes is
  'Minutes a session may stay paused before it auto-expires as PAUSED_EXPIRED. Chapter-configurable per study zone; spec default is 5.';

-- Nullable by design: null means "running in the foreground". Pause is a
-- sub-state of ACTIVE rather than its own status, so the one-active-session
-- invariant and the idx_study_sessions_active partial index keep working
-- unchanged -- only grace expiry is terminal.
alter table study_sessions
  add column if not exists paused_at timestamptz;

comment on column study_sessions.paused_at is
  'When the session was backgrounded, or null while it is running in the foreground. Foreground minutes are credited up to this instant; time after it does not accrue. Grace expiry is measured from here.';

-- Existing rows: pause_grace_minutes takes the default (5) and paused_at stays
-- null, which is exactly the pre-migration behavior -- every session in flight
-- is treated as running in the foreground, as it was before this column
-- existed. Nothing is retroactively expired.
