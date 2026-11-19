# 20261119141515_task_meeting_link.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Tasks and Up for grabs postings made from minutes keep the minutes' id in `meeting_id`, so the screens name the meeting as it is called now instead of the name baked into the description (#5562).

## Promotion

- **Purpose**: adds a nullable `meeting_id` (foreign key to `meetings`, `on delete set null`) to `tasks` and `open_tasks`, has `claim_open_task` carry it to the claimed task, backfills both from accepted task suggestions whose source is a meeting, and takes the trailing "From the minutes of …." line out of the descriptions it linked and out of pending suggestions' payloads.
- **Checks**: `select count(*) from tasks where meeting_id is not null;` is about the number of accepted meeting task suggestions (more for tasks for everyone, one per copy); `select count(*) from tasks where meeting_id is not null and description like '%From the minutes of%';` is 0.
- **Promoter notes**: run before the API deploy. The old API ignores the new column, and the new API reads it as null when it isn't there yet only through the generated types, so apply it first. It rewrites data (the descriptions and pending payloads named above) in one pass; the line it removes is generated text, never typed by a member.

## Rollback

Reverting the schema is rarely worth it: the column is nullable and unused by the old API. If needed, a forward migration drops the columns and restores the earlier `claim_open_task` body from `20261118043407_task_audiences_and_open_tasks.sql`. The removed description lines are not restored; the screens of the older API would then show no meeting name for those tasks.

```sql
alter table public.tasks drop column if exists meeting_id;
alter table public.open_tasks drop column if exists meeting_id;
-- then re-run the claim_open_task definition from 20261118043407
```
