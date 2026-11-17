# 20261117162505_backwork_ai_fill_claim.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets the backwork AI fill run once at a time per draft (#5233, `spec/behavior/backwork.md` § AI fill).

## Promotion

- **Purpose**: `backwork_resources.ai_fill_started_at` (`timestamptz`, nullable, no default) is set while an AI fill is reading a draft's file and cleared when it ends. A second fill of the same draft while it is set, and not older than the API's staleness window, is refused. Existing rows read null, which means free.
- **Checks**: `select column_name, data_type, is_nullable from information_schema.columns where table_name = 'backwork_resources' and column_name = 'ai_fill_started_at';` returns one row, `timestamp with time zone`, `YES`.
- **Promoter notes**: Additive and nullable, so no table rewrite and no backfill. Push it before the API that writes it: that API claims the column at the start of every fill, and against a database without it every fill fails. An older API ignores it. No manual steps.

## Rollback

Not worth reverting on its own: an older API ignores the column. To undo, roll back the API first (the newer one writes the column on every fill), then run the forward migration below ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
alter table public.backwork_resources drop column if exists ai_fill_started_at;
```
