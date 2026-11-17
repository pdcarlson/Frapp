# 20261117214944_backwork_ai_fill_claim.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets the backwork AI fill run once at a time per draft (#5233, `spec/behavior/backwork.md` § AI fill).

*Renumbered 2026-11-17 from `20261117162505`: it merged after staging had applied `20261117164915`, so staging's `db push` refused it as out of order and halted every staging deploy. It had been applied nowhere, so it moved after everything on `main` ([`drift-and-ordering.md` § `migration-order`](../drift-and-ordering.md#migration-order--the-required-one)).*

## Promotion

- **Purpose**: `backwork_resources.ai_fill_started_at` (`timestamptz`, nullable, no default) is set while an AI fill is reading a draft's file and cleared when it ends. A second fill of the same draft while it is set, and not older than the API's staleness window, is refused. Existing rows read null, which means free.
- **Checks**: `select column_name, data_type, is_nullable from information_schema.columns where table_name = 'backwork_resources' and column_name = 'ai_fill_started_at';` returns one row, `timestamp with time zone`, `YES`.
- **Promoter notes**: Additive and nullable, so no table rewrite and no backfill. Push it before the API that reads it: that API claims the column at the start of every fill, and backwork search names it among the columns it selects (`BACKWORK_SEARCH_COLUMNS` in `supabase-search.repository.ts`), so against a database without it every fill and every backwork search fails. An older API ignores it. No manual steps.

## Rollback

Not worth reverting on its own: an older API ignores the column. To undo, roll back the API first (the newer one writes the column on every fill and selects it on every backwork search), then run the forward migration below ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
alter table public.backwork_resources drop column if exists ai_fill_started_at;
```
