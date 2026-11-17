# 20261117214945_invites_emailed_by_creator_index.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Indexes emailed invites by sender and time, for the daily ceiling on emailed invites per inviter ([`spec/behavior/README.md` § Daily limits](../../../../spec/behavior/README.md#daily-limits)).

*Renumbered 2026-11-17 from `20261117162911`: it merged after staging had applied `20261117164915`, so staging's `db push` refused it as out of order and halted every staging deploy. It had been applied nowhere, so it moved after everything on `main` ([`drift-and-ordering.md` § `migration-order`](../drift-and-ordering.md#migration-order--the-required-one)).*

## Promotion

- **Purpose**: `idx_invites_emailed_by_creator` on `invites (created_by, created_at) where email is not null`, so the per-inviter count (`create_emailed_invites`, 20261117172019) reads only that sender's emailed invites.
- **Checks**: `select indexdef from pg_indexes where indexname = 'idx_invites_emailed_by_creator';` returns one row.
- **Promoter notes**: apply before or after the API; without it the count still works, by scanning `invites`. No data is written.

## Rollback

Safe to drop at any time; the API's read keeps working without it
([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
drop index if exists public.idx_invites_emailed_by_creator;
```
