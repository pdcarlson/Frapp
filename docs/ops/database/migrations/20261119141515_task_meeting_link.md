# 20261119141515_task_meeting_link.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Tasks and Up for grabs postings made from minutes keep the minutes' id in `meeting_id`, so the screens name the meeting as it is called now instead of the name baked into the description (#5562).

## Promotion

- **Purpose**: adds a nullable `meeting_id` to `tasks` and `open_tasks` (no foreign key, so an accept that races the minutes' delete still makes its task; an id whose minutes are gone shows nothing on screen), has `claim_open_task` carry it to the claimed task, backfills both from accepted task suggestions whose source is a meeting, and takes the generated "From the minutes of …" line out of the descriptions it linked and out of pending suggestions' payloads, only where that line ends the description; text after it is left as it is.
- **Checks**: `select count(*) from tasks where meeting_id is not null;` is about the number of accepted meeting task suggestions (more for tasks for everyone, one per copy); `select count(*) from tasks where meeting_id is not null and description ~ 'From the minutes of [^\n]*\.\s*$';` is 0 (a line followed by more text is kept on purpose).
- **Promoter notes**: run before the API deploy. The old API ignores the new column, and the new API reads it as null when it isn't there yet only through the generated types, so apply it first. It rewrites data (the descriptions and pending payloads named above); the line it removes was generated, and only where nothing a member typed follows it. `ADD COLUMN` holds `tasks` and `open_tasks` exclusively until the migration commits; the backfill joins on keys (a task's id, then its group's id) and touches only the linked rows, a few hundred on staging, so the hold is short.

## Rollback

Reverting the schema is rarely worth it: the columns are nullable and unused by the old API. If needed, a forward migration drops the columns and restores the earlier `claim_open_task` body from `20261118043407_task_audiences_and_open_tasks.sql`. The removed description lines are not restored; the screens of the older API would then show no meeting name for those tasks.

```sql
alter table public.tasks drop column if exists meeting_id;
alter table public.open_tasks drop column if exists meeting_id;
-- then re-run the claim_open_task definition from 20261118043407
```
