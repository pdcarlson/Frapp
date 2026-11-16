# 20261116201925_ai_usage_backwork_family.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets `ai_usage_events.family` hold `backwork`, the family of the upload-time draft fill (#5233).

## Promotion

- **Purpose**: the family check on `ai_usage_events` accepts `backwork` as well as `meetings`, `ask` and `corpus`, so a fill's usage row can be recorded.
- **Checks**: `select pg_get_constraintdef(oid) from pg_constraint where conname = 'ai_usage_events_family_check';` names all four families.
- **Promoter notes**: apply before the API that calls `backwork.fill`; until then a fill's usage write fails the check and the fill reports an error. No data is written.

## Rollback

Worth reverting only together with the API change. Delete the `backwork` rows first, or the old check can't be added back
([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
delete from public.ai_usage_events where family = 'backwork';
alter table public.ai_usage_events drop constraint if exists ai_usage_events_family_check;
alter table public.ai_usage_events
  add constraint ai_usage_events_family_check
  check (family in ('meetings', 'ask', 'corpus'));
```
