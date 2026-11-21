-- Report this on a channel summary (#3946, slice E2 of the AI build-out).
--
-- Catch me up stores nothing: a summary is the response to the request and
-- exists nowhere else. "Report this" (#4315) is the one exception AI text
-- has, so a reported summary is kept the way a reported Ask answer is: the
-- server sealed the exchange into the response, the member hands it back,
-- and only then is a row written, sealed, for 30 days.
--
-- This only widens which subjects a report may name. No column is added, so
-- what `ai_reports` may hold is unchanged: `sealed` is ciphertext or null.
--
-- The new check is added NOT VALID and validated after, so the table is not
-- held under an exclusive lock while existing rows are checked. Every
-- existing row already satisfies it: the old list is a subset of the new.

alter table public.ai_reports
  drop constraint if exists ai_reports_subject_type_allowed;

alter table public.ai_reports
  add constraint ai_reports_subject_type_allowed
  check (
    subject_type in ('ask_answer', 'meeting_draft', 'ai_suggestion', 'chat_summary')
  ) not valid;

alter table public.ai_reports
  validate constraint ai_reports_subject_type_allowed;
