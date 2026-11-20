# 20261120005145_chapter_link_per_role.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets a chapter keep one live chapter link per role instead of one in all, so an officer can post a pledge class link and a brothers link at once (Paul, 2026-11-19, #5633).

## Promotion

- **Purpose**: replaces the partial unique index `invites_one_chapter_link` on `invites (chapter_id)` with `invites_one_chapter_link_per_role` on `invites (chapter_id, role)`, both where `reusable and revoked_at is null`. No column changes; every existing link keeps working.
- **Checks**: after `db push`, this returns `invites_one_chapter_link_per_role` and no `invites_one_chapter_link`:

  ```sql
  select indexname from pg_indexes
   where schemaname = 'public' and tablename = 'invites' and indexname like 'invites_one_chapter_link%';
  ```

- **Promoter notes**: schema only, no data written. Push it before the API that makes a link per role, as the deploy workflow already does. An API running ahead of it would refuse a second role's link with 409 (`invite.chapter_link_conflict`) until it lands; nothing breaks.

## Rollback

Revert only after rolling the API back to a build that makes one link per chapter, and only once at most one live chapter link per chapter remains (turn off the extras first, or the index can't be built):

```sql
drop index if exists public.invites_one_chapter_link_per_role;
create unique index if not exists invites_one_chapter_link
  on public.invites (chapter_id)
  where reusable and revoked_at is null;
```
