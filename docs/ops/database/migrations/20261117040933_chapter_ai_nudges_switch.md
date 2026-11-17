# 20261117040933_chapter_ai_nudges_switch.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Gives nudge cards their own chapter AI switch, `chapter_ai_settings.nudges_enabled`, on by default, and lets `ai_usage_events.family` be `nudges` (asked by Paul, 2026-11-17).

## Promotion

- **Purpose**: every chapter has nudges on unless its president turns them off; a nudge's model call is recorded under its own family instead of Ask's. Members still get a card only after their own Yes to Frapp AI.
- **Checks**: `select count(*) from chapter_ai_settings where not nudges_enabled;` returns 0 straight after the push. `select conname from pg_constraint where conname = 'ai_usage_events_family_check' and convalidated;` returns one row.
- **Promoter notes**: push before the API deploy. The API from before this change never reads the column and never writes `nudges`, so the old API runs on the new schema. The new API writes `nudges` usage rows, so it must not run on the old schema. Writes no data beyond the column default.

## Rollback

Reverting is worth it only if the API is rolled back past this change and the column is in the way, which it isn't (old code ignores it). If needed, a forward migration:

```sql
alter table public.ai_usage_events drop constraint if exists ai_usage_events_family_check;
update public.ai_usage_events set family = 'ask' where family = 'nudges';
alter table public.ai_usage_events
  add constraint ai_usage_events_family_check
  check (family in ('meetings', 'ask', 'corpus', 'backwork')) not valid;
alter table public.ai_usage_events validate constraint ai_usage_events_family_check;
alter table public.chapter_ai_settings drop column if exists nudges_enabled;
```
