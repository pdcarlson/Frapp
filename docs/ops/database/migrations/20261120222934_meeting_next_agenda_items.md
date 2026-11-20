# 20261120222934_meeting_next_agenda_items.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the list of action items an officer sent from posted minutes to the next meeting's agenda instead of making them tasks, and lets an upcoming meeting's Suggested list hold them (#5790).

## Promotion

- **Purpose**: `meeting_next_agenda_items` holds each action item sent on, one per suggested task (`ai_suggestion_id` unique), with RLS on and no policies, so only the API reads or writes it. `event_agenda_suggestions.kind` also allows `minutes`, the kind such an item takes when an upcoming meeting with the same audience offers it.
- **Checks**: `select relrowsecurity from pg_class where relname = 'meeting_next_agenda_items';` returns `t`. `select count(*) from pg_policies where tablename = 'meeting_next_agenda_items';` returns 0. `select pg_get_constraintdef(oid) from pg_constraint where conname = 'event_agenda_suggestions_kind_check';` names `tabled`, `minutes` and `ai`, and `convalidated` is `t` for it.
- **Promoter notes**: Apply before the API that uses it; the API from before this never writes `minutes` or reads the new table, so the deploy window and an API rollback both hold. Writes no data. The new table's foreign-key locks on `chapters`, `meetings`, `ai_suggestions` and `users` last milliseconds; the kind check is swapped NOT VALID and then validated, over a few rows per upcoming meeting.

## Rollback

Worth reverting only with the API that uses it also reverted. Dropping the table loses which action items were sent on (their suggested tasks stay dismissed); agenda items already added from them stay on their events. Delete the `minutes` suggestions before narrowing the check, or the add fails.

```sql
delete from public.event_agenda_suggestions where kind = 'minutes';
alter table public.event_agenda_suggestions
  drop constraint if exists event_agenda_suggestions_kind_check;
alter table public.event_agenda_suggestions
  add constraint event_agenda_suggestions_kind_check
  check (kind in ('tabled', 'ai'));
drop table if exists public.meeting_next_agenda_items;
```
