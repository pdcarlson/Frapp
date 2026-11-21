# 20261118173946_activity_layouts.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `activity_layouts`, where each member's order and hidden set of Activity cards is kept per chapter, and teaches `anonymize_user` to delete it (#5520).

## Promotion

- **Purpose**: a new table `public.activity_layouts`, one row per `(user_id, chapter_id)` with `card_order text[]` and `hidden_cards text[]`, each capped at 32 keys by a check constraint, RLS on with no policies, and an `updated_at` trigger. `anonymize_user` is replaced with the same body plus `delete from activity_layouts where user_id = p_user_id`. No row means the member's role default, so the table starts empty.
- **Checks**: `select relrowsecurity from pg_class where oid = 'public.activity_layouts'::regclass;` returns `t`. `select count(*) from pg_policies where tablename = 'activity_layouts';` returns 0. `select conname from pg_constraint where conrelid = 'public.activity_layouts'::regclass;` lists `activity_layouts_card_order_max` and `activity_layouts_hidden_cards_max`. `select prosrc like '%activity_layouts%' from pg_proc where proname = 'anonymize_user';` returns `t`.
- **Promoter notes**: Apply before the API that serves `/v1/activity/layout`; until then those routes answer 500 and every other route is unaffected. The API from before this ignores the table. Writes no data.

## Rollback

Worth reverting only with the API that serves `/v1/activity/layout` also reverted: members lose their saved card order and see their role's default. Restore `anonymize_user` from `20261114161219_chat_message_reminders.sql` first (its body, unchanged), since this migration's version deletes from the table, then drop the table.

```sql
-- 1. Re-run the `create or replace function anonymize_user(...)` statement from
--    supabase/migrations/20261114161219_chat_message_reminders.sql verbatim.
-- 2. Then:
drop table if exists public.activity_layouts;
```
