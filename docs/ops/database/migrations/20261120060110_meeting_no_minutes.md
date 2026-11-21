# 20261120060110_meeting_no_minutes.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `meeting_no_minutes`, the meetings an officer marked as having no minutes, so the Meetings list stops asking for them (Paul, 2026-11-20).

## Promotion

- **Purpose**: a new table (RLS on, no policies; the API writes it with the service role) and a trigger on `meetings` that drops an event's mark when minutes start on it.
- **Checks**: `select to_regclass('public.meeting_no_minutes');` is not null, and `select tgname from pg_trigger where tgname = 'meetings_drop_no_minutes_on_start';` returns one row.
- **Promoter notes**: additive; push before the API that reads it. Writes no data.

## Rollback

Reverting is worth it only if the trigger misbehaves; nothing else reads the table. A forward migration drops both, and the marks are lost (the list asks for those minutes again).

```sql
drop trigger if exists meetings_drop_no_minutes_on_start on public.meetings;
drop function if exists public.meeting_no_minutes_drop_on_start();
drop table if exists public.meeting_no_minutes;
```
