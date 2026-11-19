# 20261119171715_chapter_invite_link.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Invites gain `reusable`, so a chapter can have one shareable link that many people join with until it expires or an officer turns it off (#3353).

## Promotion

- **Purpose**: adds `invites.reusable boolean not null default false` and a partial unique index allowing one live (not revoked) reusable invite per chapter. Every existing invite stays single-use.
- **Checks**: `select count(*) from invites where reusable;` is 0 right after the push; `select indexname from pg_indexes where indexname = 'invites_one_chapter_link';` returns one row.
- **Promoter notes**: run before the API deploy: the new API writes and reads `reusable`; the old API ignores it. No data is written. `ADD COLUMN` with a constant default is a catalog-only change on Postgres 11+, and the index is built over `invites`, a small table (a few hundred rows on staging), so the locks are brief.

## Rollback

Rarely worth it: the column defaults to false and the old API never reads it. If needed, a forward migration drops the index and the column; any chapter link then becomes an ordinary single-use invite for whoever opens it first, so revoke them first.

```sql
update public.invites set revoked_at = now(), used_at = coalesce(used_at, now())
  where reusable and revoked_at is null;
drop index if exists public.invites_one_chapter_link;
alter table public.invites drop column if exists reusable;
```
