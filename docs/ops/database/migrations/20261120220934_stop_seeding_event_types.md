# 20261120220934_stop_seeding_event_types.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

New chapters start with no event types: drops the trigger that seeded seven into every new chapter (#5776, Paul 2026-11-20).

## Promotion

- **Purpose**: Drops `trg_chapters_seed_event_types` on `public.chapters` and the functions `public.chapters_seed_event_types()` and `public.seed_default_event_types(uuid)` from `20261111200000_event_types.sql`. A chapter created afterwards has no `event_types` rows until an officer makes one from the event form's Type menu. Existing chapters keep every type they have; no row is written or deleted.
- **Checks**: `select count(*) from pg_trigger where tgname = 'trg_chapters_seed_event_types';` returns 0, and `select count(*) from pg_proc where proname in ('chapters_seed_event_types', 'seed_default_event_types');` returns 0.
- **Promoter notes**: Independent of the API deploy: no API code calls either function. Writes no data.

## Rollback

Revert only if new chapters must start with the seven types again. Run a forward migration that re-creates the two functions, the trigger and their grants exactly as `supabase/migrations/20261111200000_event_types.sql` defines them (the `create or replace function public.seed_default_event_types` block through the `grant execute ... to service_role` block), without its backfill line (`select public.seed_default_event_types(id) from public.chapters;`), so chapters made in between stay as their officers left them ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)).

```sql
-- Re-create from 20261111200000_event_types.sql:
--   public.seed_default_event_types(uuid), public.chapters_seed_event_types(),
--   trigger trg_chapters_seed_event_types (after insert on public.chapters),
--   and the revoke/grant block; omit the backfill select.
```
