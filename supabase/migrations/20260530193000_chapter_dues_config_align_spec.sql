-- Chunk 07d: align chapter_dues_config with the canonical spec
-- (spec/behavior/settings/customization.md → Dues Tab).
--
-- The stub table shipped in 20260523120000 with cadence
-- ('semester','monthly','annual') and no installment count. The spec is canon:
--   * cadence is one of monthly / per_semester / per_quarter
--   * installments are a toggle + a count
-- The table has had no read/write API until this chunk, so there is effectively
-- no data to migrate; the UPDATE below is defensive for any stub rows.

-- 1. Drop the old cadence CHECK constraint (system-generated name).
alter table chapter_dues_config
  drop constraint if exists chapter_dues_config_cadence_check;

-- 2. New default + CHECK matching the spec.
-- No data re-map is needed: chapter_dues_config has had no read/write path since
-- it was created (20260523120000) — no API, onboarding never provisions a row,
-- and seed.sql doesn't touch it — so the table is empty in every environment and
-- the new CHECK can't be violated by an existing row.
alter table chapter_dues_config
  alter column cadence set default 'per_semester',
  add constraint chapter_dues_config_cadence_check
    check (cadence in ('monthly', 'per_semester', 'per_quarter'));

-- 3. Installment count (the spec's "toggle + count"; the toggle stays as the
--    existing installments_allowed boolean). At least 1 when a plan exists.
alter table chapter_dues_config
  add column if not exists installment_count int not null default 1
    check (installment_count >= 1);
