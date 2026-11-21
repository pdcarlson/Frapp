# 20261117195822_meetings_keep_transcript.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `meetings.transcript` and a trigger that copies a recording's transcript onto the minutes when they are posted, so posting no longer loses it (#5410).

## Promotion

- **Purpose**: posted minutes carry the transcript of their recording; the `meeting_recordings` row and its audio are still removed on posting.
- **Checks**: `select column_name from information_schema.columns where table_name = 'meetings' and column_name = 'transcript';` returns one row, and `select tgname from pg_trigger where tgname = 'meetings_keep_transcript_on_post';` returns one row.
- **Promoter notes**: additive; apply before the API that reads `transcript`. Writes no data on its own. Minutes posted before it have no transcript.

## Rollback

Reverting is worth it only if the trigger blocks posting. A forward migration drops the trigger; keep the column so no transcript is lost ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
drop trigger if exists meetings_keep_transcript_on_post on public.meetings;
drop function if exists public.meetings_keep_transcript_on_post();
```
