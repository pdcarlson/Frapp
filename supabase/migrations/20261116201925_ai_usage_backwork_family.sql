-- The upload-time backwork fill (#5233) is its own AI family, `backwork`, so
-- its spend reads apart from Ask's. It sits behind the same chapter switch as
-- Ask (`AI_FAMILY_SWITCH`), so no new setting.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_family_check;
-- Added NOT VALID and validated in a second statement, as
-- 20261112210000_meeting_recordings.sql does for this table, so it is not
-- held under ACCESS EXCLUSIVE while its rows are read.
alter table public.ai_usage_events
  add constraint ai_usage_events_family_check
  check (family in ('meetings', 'ask', 'corpus', 'backwork')) not valid;
alter table public.ai_usage_events
  validate constraint ai_usage_events_family_check;
