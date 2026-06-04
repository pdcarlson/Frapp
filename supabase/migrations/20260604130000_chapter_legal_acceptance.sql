-- FRA-17: record Terms of Service + Privacy Policy acceptance captured during
-- chapter creation. The onboarding wizard requires the admin to accept before
-- "Create chapter" is enabled; ChapterOnboardingService stamps these columns
-- from the authenticated session actor + server clock at create time.
--   spec/product/onboarding.md (step 4 — required checkbox before payment)
--   spec/behavior/legal.md   (accepted during chapter creation; persisted, auditable)
--
-- Null legal_accepted_at = a legacy chapter created before this shipped. No
-- backfill: we never captured explicit consent for those, so we don't fabricate
-- a timestamp/version. legal_accepted_by uses `on delete set null` (matching the
-- audit_log actor FK) so deleting the accepting user never blocks; the chapter
-- and its acceptance record survive.

alter table chapters
  add column if not exists legal_accepted_at timestamptz,
  add column if not exists legal_policy_version text,
  add column if not exists legal_accepted_by uuid references users(id) on delete set null;
