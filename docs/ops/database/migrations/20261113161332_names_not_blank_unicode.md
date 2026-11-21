# 20261113161332_names_not_blank_unicode.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Makes the five name not-blank checks call "blank" exactly what the API's `/\S/` does, so a name of only U+FEFF, U+00A0 or U+202F is refused under any collation (#4770).

## Promotion

- **Purpose**: Replaces `chapter_pledge_classes_name_not_blank`, `role_tiers_name_not_blank`, `event_types_name_not_blank`, `chapter_groups_name_not_blank` and `roles_name_not_blank` (each was `check (name ~ '[^[:space:]]')`) with `check (name ~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]')`, which lists JavaScript's `\s` by code point. `[:space:]` follows the column's collation: it let U+FEFF through under every collation and U+00A0 and U+202F under libc ones, and refused U+0085, which the API accepts. Before the checks change, any row the new check would refuse is renamed "Unnamed class / tier / type / group / role" plus the first 8 characters of its id, as `20261113132007` and `20261113145556` did.
- **Checks**: Before `db push`, `select count(*) from public.roles where name !~ '[^\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]';` (and the same for the other four tables) says how many rows the backfill will rename; expect `0`. After: `select count(*) from pg_constraint where conname like '%\_name\_not\_blank' and pg_get_constraintdef(oid) not like '%[:space:]%';` returns `5`, and `begin; insert into public.roles (chapter_id, name, permissions) select id, U&'\FEFF', '{}' from public.chapters limit 1; rollback;` fails with `roles_name_not_blank`.
- **Promoter notes**: Order against the API doesn't matter: the API already refuses these names. It writes data only for rows named with only such characters (expected none). `drop constraint if exists` makes re-applying idempotent. Must apply after `20261113132007` and `20261113145556`, which its version guarantees. Nothing by hand.

## Rollback

Not worth reverting on its own: the checks only refuse names the API already refuses. If they must go back to `[:space:]`, in a later forward migration ([§ 3) Undo one migration](../../db-rollback-playbook.md#3-undo-one-migration)). A renamed row keeps its new name.

```sql
alter table public.chapter_pledge_classes drop constraint if exists chapter_pledge_classes_name_not_blank;
alter table public.chapter_pledge_classes add constraint chapter_pledge_classes_name_not_blank check (name ~ '[^[:space:]]');
alter table public.role_tiers drop constraint if exists role_tiers_name_not_blank;
alter table public.role_tiers add constraint role_tiers_name_not_blank check (name ~ '[^[:space:]]');
alter table public.event_types drop constraint if exists event_types_name_not_blank;
alter table public.event_types add constraint event_types_name_not_blank check (name ~ '[^[:space:]]');
alter table public.chapter_groups drop constraint if exists chapter_groups_name_not_blank;
alter table public.chapter_groups add constraint chapter_groups_name_not_blank check (name ~ '[^[:space:]]');
alter table public.roles drop constraint if exists roles_name_not_blank;
alter table public.roles add constraint roles_name_not_blank check (name ~ '[^[:space:]]');
```
