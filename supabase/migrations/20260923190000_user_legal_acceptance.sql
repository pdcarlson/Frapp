-- #2302: record each user's own Terms of Service + Privacy Policy acceptance.
--
-- Until now the only record was chapter-level (20260604130000_chapter_legal_acceptance.sql):
-- the founding officer accepts in the create-chapter wizard, and every member
-- who joins by invite agreed to nothing. App Review Guideline 1.2 expects the
-- person posting user-generated content to have agreed to terms that forbid
-- objectionable content, so acceptance moves to the user.
--
-- The shape mirrors the chapter columns, minus `legal_accepted_by`, because the
-- accepting user is the row itself. `LegalAcceptanceService` (apps/api) stamps
-- both columns from the authenticated session and the server's
-- LEGAL_POLICY_VERSION, never from the client. A user whose
-- `legal_policy_version` is not the current version is asked again, so a policy
-- change re-prompts everyone once.
--
-- The chapter-level record stays: it is the officer agreeing on the chapter's
-- behalf, a different claim from a member agreeing for themselves.
--
-- Null = never accepted. No backfill: the chapter record says what the founding
-- officer accepted for the chapter, not what they accepted for themselves, and
-- the version changes in the same release anyway, so everyone is asked once.
--
-- `anonymize_user` deliberately leaves both columns alone. They are not PII, and
-- they are the record of what a since-deleted account had agreed to.
--   spec/behavior/legal.md § Acceptance record

alter table users
  add column if not exists legal_accepted_at timestamptz,
  add column if not exists legal_policy_version text;
