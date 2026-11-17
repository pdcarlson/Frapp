-- Nudge cards get their own chapter switch, on unless the president turns it
-- off (Paul, 2026-11-17: "We should turn on nudges on activity by default").
-- Until now a card was booked under Ask's switch, which starts off. A member
-- still gets a card only after their own Yes to Frapp AI (`spec/behavior/
-- ai.md` § Consent); this default removes only the president's step.
--
-- `default true` fills every existing row, so a chapter that has a row keeps
-- nudges on too; a chapter with no row reads as on in the API
-- (`AI_SWITCHES_ON_BY_DEFAULT`).
alter table public.chapter_ai_settings
  add column if not exists nudges_enabled boolean not null default true;

-- A card's model call is its own family, `nudges`, so its spend reads apart
-- from Ask's, as 20261116201925_ai_usage_backwork_family.sql did for backwork.
alter table public.ai_usage_events
  drop constraint if exists ai_usage_events_family_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_family_check
  check (family in ('meetings', 'ask', 'corpus', 'backwork', 'nudges')) not valid;
alter table public.ai_usage_events
  validate constraint ai_usage_events_family_check;

comment on table public.chapter_ai_settings is
  'The president''s AI switches, one per feature family; no row is all off except nudges, which the API reads as on (AI_SWITCHES_ON_BY_DEFAULT). API only. See 20261112165040_ai_consent.sql and 20261117040933_chapter_ai_nudges_switch.sql.';

comment on table public.chapter_ai_settings is
  'The president''s AI switches, one per feature family; no row is all off except nudges, which the API reads as on (AI_SWITCHES_ON_BY_DEFAULT). API only. See 20261112165040_ai_consent.sql and 20261117040933_chapter_ai_nudges_switch.sql.';
