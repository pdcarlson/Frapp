# 20261114154540_activity_item_snoozes.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `activity_item_snoozes`, each member's snoozed Activity rows and when each comes back (#4982, item 7 of #4402).

## Promotion

- **Purpose**: One row per member per item (`user_id`, `chapter_id`, `kind`, `item_id`, `until`, `created_at`; primary key on the first four), cascading with the member's `members` row, so leaving the chapter or deleting the account drops it. RLS on, no policies (API only, service role). No existing table or function changes.
- **Checks**: `select to_regclass('public.activity_item_snoozes');` is not null, and `select conname from pg_constraint where conname = 'activity_item_snoozes_member_fkey';` returns one row.
- **Promoter notes**: Apply before the API that serves `snoozed_until` and the `/v1/activity/snoozes` routes; until it lands those routes fail and `GET /v1/activity` serves nothing as snoozed (the read reports the failure and carries on). Writes no data.

## Rollback

Drop the table with a forward migration once no API reads it. Members lose their snoozes, and the rows come back on their list at once.

```sql
drop table if exists public.activity_item_snoozes;
```
