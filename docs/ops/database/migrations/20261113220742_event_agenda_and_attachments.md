# 20261113220742_event_agenda_and_attachments.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds an event's agenda and attachments as two JSON list columns on `events`, and has `delete_replaced_occurrences` carry them onto the meeting that replaces a rebuilt one (#4934). The rule is [`spec/behavior/events.md` § Agenda and attachments](../../../../spec/behavior/events.md#agenda-and-attachments).

## Promotion

- **Purpose**: `events.agenda` and `events.attachments`, both `jsonb not null default '[]'`, each with a check that it is an array of at most 30 (agenda) or 10 (attachments) entries. The API validates each entry's shape. `delete_replaced_occurrences` is replaced (`create or replace`, same signature and grants) so that each matched old-to-new pair also copies the old meeting's agenda and attachments to the new one.
- **Checks**: After `db push`, `select count(*) from information_schema.columns where table_name = 'events' and column_name in ('agenda', 'attachments');` returns `2`, `select count(*) from events where agenda <> '[]' or attachments <> '[]';` returns `0` on a database the new API hasn't written to, and `select has_function_privilege('authenticated', 'public.delete_replaced_occurrences(uuid, uuid[], uuid[], uuid[])', 'execute');` still returns `false`.
- **Promoter notes**: Ship it before, or with, the API from the same PR; a deploy applies migrations first. The older API reads `select('*')` and ignores the new columns. Adding a column with a constant default is a metadata-only change in Postgres, so the table is not rewritten. No data written, nothing by hand.

## Rollback

Revert the API forward and keep the migration file ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). The columns are harmless to the reverted API. To remove them, after the code revert has shipped, in a later forward migration. This drops every agenda and attachment officers have written, so export them first if any exist. In the same migration, first re-create `delete_replaced_occurrences` from `20261113040010_series_edit_carries_excuses.sql`'s `create or replace function` body, which doesn't name the columns, so no series edit calls a function that reads a dropped column. Then:

```sql
alter table public.events
  drop constraint if exists events_agenda_is_list,
  drop constraint if exists events_attachments_is_list,
  drop column if exists agenda,
  drop column if exists attachments;
```
