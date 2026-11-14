# 20261114160211_chat_sidebar_sort.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `sort` to `chat_sidebar_preferences`, so a member chooses how channels sort inside each sidebar section: the chapter's order, recent activity, or A to Z (#2877).

## Promotion

- **Purpose**: `chat_sidebar_preferences.sort text not null default 'chapter'`, checked to `chapter`, `recent` or `alpha`. Every existing row reads `chapter`, the order members saw before. The rule is `spec/behavior/chat/README.md` § Sidebar arrangement.
- **Checks**: `select sort, count(*) from chat_sidebar_preferences group by sort;` runs and shows only `chapter` right after promotion.
- **Promoter notes**: apply before the API that reads the column. The API serving now ignores it. Adding a column with a constant default rewrites no rows, and the check constraint validates rows that already hold the default. Nothing is done by hand.

## Rollback

Rarely worth it: the column is additive. If needed, revert the API first, then run a forward migration that drops the column. Members lose only their sort choice and fall back to the chapter's order.

```sql
alter table public.chat_sidebar_preferences
  drop constraint if exists chat_sidebar_preferences_sort_check;
alter table public.chat_sidebar_preferences
  drop column if exists sort;
```
