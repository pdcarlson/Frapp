# 20261120222934_meeting_next_agenda_items.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the record of action items an officer sent from posted minutes to the next meeting's agenda instead of making them tasks, and lets an upcoming meeting's Suggested list hold the ones that couldn't go straight on (#5790).

## Promotion

- **Purpose**: `meeting_next_agenda_items` holds each action item sent on, one per suggested task (`ai_suggestion_id` unique): `placed` on a meeting's agenda, `offered` under Suggested, or `waiting` (30 days at most) for the next meeting to be created, with the suggestion's words kept for Undo. RLS on and no policies, so only the API reads or writes it; the API's hourly AI-suggestion sweep places `waiting` rows a new meeting can take, deletes expired ones, and empties the kept words after a day. `delete_replaced_occurrences` also moves these rows onto a rebuilt meeting, as it moves agendas. `event_agenda_suggestions.kind` also allows `minutes`, the kind such an item takes when an upcoming meeting with the same audience offers it.
- **Checks**: `select relrowsecurity from pg_class where relname = 'meeting_next_agenda_items';` returns `t`. `select count(*) from pg_policies where tablename = 'meeting_next_agenda_items';` returns 0. `select pg_get_constraintdef(oid) from pg_constraint where conname = 'event_agenda_suggestions_kind_check';` names `tabled`, `minutes` and `ai`, and `convalidated` is `t` for it. `select prosrc like '%meeting_next_agenda_items%' from pg_proc where proname = 'delete_replaced_occurrences';` returns `t`.
- **Promoter notes**: Apply before the API that uses it; the API from before this never writes `minutes` or reads the new table, so the deploy window and an API rollback both hold. Writes no data. The file runs in one transaction, so every lock holds until it commits: SHARE ROW EXCLUSIVE on `chapters`, `meetings`, `events`, `ai_suggestions` and `users` for the new foreign keys, and ACCESS EXCLUSIVE on `event_agenda_suggestions` for the kind check, whose add reads that table (a few rows per upcoming meeting). It commits in milliseconds.

## Rollback

Worth reverting only with the API that uses it also reverted. Dropping the table loses which action items were sent on, and any still waiting for a meeting (their suggested tasks stay dismissed); agenda items already placed stay on their events. Put `delete_replaced_occurrences` back first, since this file's version names the table: re-run its definition from `20261118191604_event_agenda_suggestions.sql` (the `create or replace function` statement only; its grants carry over). Delete the `minutes` suggestions before narrowing the check, or the add fails.

```sql
-- 1. Re-run the create or replace function public.delete_replaced_occurrences(...)
--    statement from 20261118191604_event_agenda_suggestions.sql.
-- 2. Then:
delete from public.event_agenda_suggestions where kind = 'minutes';
alter table public.event_agenda_suggestions
  drop constraint if exists event_agenda_suggestions_kind_check;
alter table public.event_agenda_suggestions
  add constraint event_agenda_suggestions_kind_check
  check (kind in ('tabled', 'ai'));
drop table if exists public.meeting_next_agenda_items;
```
