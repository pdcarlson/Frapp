# 20261113130014_roles_name_not_blank.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds a check that a role's name is not empty or only whitespace, matching the API's refusal of such a name (#4749).

## Promotion

- **Purpose**: Renames any role whose name is blank after trimming to `Unnamed role <first 8 characters of its id>`, then adds `roles_name_not_blank check (btrim(name) <> '')` on `public.roles`. Only an API call made outside the apps could have stored such a name, so the update is expected to touch no rows.
- **Checks**: After `db push`, `select count(*) from public.roles where btrim(name) = '';` returns `0`, and `select count(*) from pg_constraint where conname = 'roles_name_not_blank';` returns `1`.
- **Promoter notes**: Order against the API doesn't matter: the older API never sends a blank name from the apps, and a direct call with one now fails at the database instead of being stored. It writes data only for blank-named rows (expected none). `drop constraint if exists` makes re-applying idempotent. Nothing by hand.

## Rollback

Not worth reverting on its own: the check only refuses names no client shows. If it must go, in a later forward migration ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). A renamed role keeps its new name.

```sql
alter table public.roles drop constraint if exists roles_name_not_blank;
```
