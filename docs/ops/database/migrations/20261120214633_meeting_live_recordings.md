# 20261120214633_meeting_live_recordings.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `meeting_live_recordings`, which minutes a phone is recording right now, so the Minutes list and the event's Minutes card can say "Winston Hewitt is recording" (Paul, 2026-11-20).

## Promotion

- **Purpose**: a new table (RLS on, no policies; the API writes it with the service role). The recording phone writes a row when it starts, refreshes it every minute and deletes it when it stops.
- **Checks**: `select to_regclass('public.meeting_live_recordings');` is not null.
- **Promoter notes**: additive; push before the API that reads it. Writes no data.

## Rollback

Reverting is worth it only if the table misbehaves; the lists then stop saying who is recording. A forward migration drops it.

```sql
drop table if exists public.meeting_live_recordings;
```
