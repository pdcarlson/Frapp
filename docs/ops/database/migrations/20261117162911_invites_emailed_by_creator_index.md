# 20261117162911_invites_emailed_by_creator_index.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Indexes emailed invites by sender and time, for the daily ceiling on emailed invites per inviter ([`spec/behavior/README.md` § Daily limits](../../../../spec/behavior/README.md#daily-limits)).

## Promotion

- **Purpose**: `idx_invites_emailed_by_creator` on `invites (created_by, created_at) where email is not null`, so the API's per-inviter count reads only that sender's emailed invites.
- **Checks**: `select indexdef from pg_indexes where indexname = 'idx_invites_emailed_by_creator';` returns one row.
- **Promoter notes**: apply before or after the API; without it the count still works, by scanning `invites`. No data is written.

## Rollback

Safe to drop at any time; the API's read keeps working without it
([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
drop index if exists public.idx_invites_emailed_by_creator;
```
