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

-- 2. Re-map any pre-existing cadence values onto the spec vocabulary before the
--    new constraint lands. 'semester' and the now-unsupported 'annual' both fall
--    back to the modal 'per_semester' (proper annual support is a follow-up).
update chapter_dues_config
  set cadence = 'per_semester'
  where cadence in ('semester', 'annual');

-- 3. New default + CHECK matching the spec.
alter table chapter_dues_config
  alter column cadence set default 'per_semester',
  add constraint chapter_dues_config_cadence_check
    check (cadence in ('monthly', 'per_semester', 'per_quarter'));

-- 4. Installment count (the spec's "toggle + count"; the toggle stays as the
--    existing installments_allowed boolean). At least 1 when a plan exists.
alter table chapter_dues_config
  add column if not exists installment_count int not null default 1
    check (installment_count >= 1);
