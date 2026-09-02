-- Points anti-fraud limits become chapter-configurable (#394 —
-- spec/behavior/points.md, the "Anti-Fraud" section).
--
-- The spec has always described both limits as chapter-configurable:
--   "Rate limiting: A single admin cannot create more than N point
--    adjustments per hour (chapter-configurable, default 50)."
--   "Anomaly flagging: If a single transaction exceeds a configurable
--    threshold (e.g. +/- 100 points, chapter-configurable) ..."
-- PointsService hardcoded both (RATE_LIMIT_MAX = 50, anomalyThreshold = 100),
-- so the code was the side that had drifted. This is the storage half.
--
-- One additive table; no column is dropped, renamed, or backfilled.

-- ── chapter_points_config ────────────────────────────────────────────────────
-- One row per chapter (PK = chapter_id), mirroring chapter_service_config
-- (20260809124500) and chapter_dues_config (20260523120000). RLS is enabled
-- with no policies: like every other chapter config table, this is reached
-- only through the API's service-role client.
--
-- The defaults are exactly the constants PointsService hardcoded before this
-- migration, so every existing chapter keeps its current behaviour and no
-- backfill is needed — an absent row IS the default, which is why nothing
-- provisions rows here at onboarding.

create table if not exists chapter_points_config (
  chapter_id                     uuid        primary key references chapters(id) on delete cascade,
  -- Max manual adjustments one admin may create per rolling hour. `>= 1`, not
  -- `>= 0`: a stored 0 would refuse every adjustment forever, locking a
  -- chapter out of its own ledger through a settings dial with no way back
  -- through the API (the ledger is append-only, so there is no corrective
  -- write either). A chapter that wants adjustments off removes the
  -- permission, which is the control that exists for it.
  adjustment_rate_limit_per_hour int         not null default 50  check (adjustment_rate_limit_per_hour >= 1),
  -- Absolute amount at or above which a committed row is flagged for review.
  -- `>= 1` for a different reason than the rate limit: at 0, `abs(amount) >= 0`
  -- is true for every row, so the Audit tab's flagged filter would return the
  -- entire ledger and flagging would carry no signal at all.
  --
  -- Deliberately not bounded above by the ±100,000 hard ceiling: a threshold
  -- set above the ceiling is a coherent way to say "never flag", and coupling
  -- the two would make raising the ceiling later a breaking change here.
  anomaly_threshold              int         not null default 100 check (anomaly_threshold >= 1),
  created_at                     timestamptz not null default now(),
  updated_at                     timestamptz not null default now()
);

alter table chapter_points_config enable row level security;

drop trigger if exists trg_chapter_points_config_updated_at on chapter_points_config;
create trigger trg_chapter_points_config_updated_at
  before update on chapter_points_config
  for each row execute function update_updated_at();
