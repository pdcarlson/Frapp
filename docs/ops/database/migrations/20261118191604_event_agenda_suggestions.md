# 20261118191604_event_agenda_suggestions.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the tables behind an upcoming meeting's Suggested agenda items, tabled matters first (#5534).

## Promotion

- **Purpose**: `event_agenda_suggestions` holds each suggestion offered under an event's agenda (a tabled matter from earlier minutes, or an item the `agenda.suggest` model wrote), kept after it is added or dismissed so the next prompt can learn from it. `event_agenda_suggestion_runs` records when the model last wrote suggestions for an event. Both have RLS on and no policies: only the API reads or writes them.
- **Checks**: `select relrowsecurity from pg_class where relname in ('event_agenda_suggestions', 'event_agenda_suggestion_runs');` returns two `t`. `select count(*) from pg_policies where tablename in ('event_agenda_suggestions', 'event_agenda_suggestion_runs');` returns 0. `select conname from pg_constraint where conrelid = 'public.event_agenda_suggestions'::regclass;` lists `event_agenda_suggestions_event_key`.
- **Promoter notes**: Apply before the API that reads them; the API from before this never touches them, so the deploy window and an API rollback both hold. Writes no data. Both tables are new, so the foreign keys' locks on `chapters`, `events`, `meetings` and `users` last milliseconds.

## Rollback

Worth reverting only with the API that uses the tables also reverted. Dropping them loses the suggestions and what was added or dismissed; the agenda items added from them stay on their events.

```sql
drop table if exists public.event_agenda_suggestion_runs;
drop table if exists public.event_agenda_suggestions;
```
