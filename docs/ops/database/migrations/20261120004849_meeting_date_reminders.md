# 20261120004849_meeting_date_reminders.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `meeting_date_reminders`, a member's private "Remind me" on a Coming up date in minutes, and the trigger that deletes a member's reminders when their account is deleted (#5672 step 2).

## Promotion

- **Purpose**: any reader of posted minutes can ask to be reminded about one of its Coming up dates. One row per member per date (its day and words); the API's minute sweep deletes a row as it sends its push. Rows go with the minutes, the chapter, or the member's account.
- **Checks**: `select to_regclass('public.meeting_date_reminders');` is not null. `select tgname from pg_trigger where tgname = 'users_drop_meeting_date_reminders';` returns one row. `select relrowsecurity from pg_class where oid = 'public.meeting_date_reminders'::regclass;` is true.
- **Promoter notes**: apply before the API that reads the table deploys. The older API never reads it, so applying it early is safe. It writes no data.

## Rollback

Reverting is worth it only if the table or its trigger cause trouble; the older API never reads them. Dropping the table loses only reminders not yet sent. Run a forward migration ([playbook](../../db-rollback-playbook.md#decision-matrix)):

```sql
drop trigger if exists users_drop_meeting_date_reminders on public.users;
drop function if exists public.meeting_date_reminders_drop_for_deleted_user();
drop table if exists public.meeting_date_reminders;
```
