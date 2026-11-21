# 20261121000553_members_can_change_name.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the chapter setting that stops members from changing their own name after they join (#5801).

## Promotion

- **Purpose**: `chapters.members_can_change_name` (boolean, not null, default `false`). While false, the API refuses a member's own rename once they have settled in (finished the welcome screen or joined over a day ago) that chapter, their only chapter, unless they hold `roles:manage` there. Every existing chapter starts with names locked.
- **Checks**: `select column_default, is_nullable from information_schema.columns where table_name = 'chapters' and column_name = 'members_can_change_name';` returns `false` and `NO`. `select count(*) from chapters where members_can_change_name;` returns 0 right after.
- **Promoter notes**: Apply before the API that reads it; the API from before this never reads the column, so the deploy window and an API rollback both hold. Adding a column with a constant default is a metadata-only change in Postgres 11+, so it takes ACCESS EXCLUSIVE on `chapters` for milliseconds and rewrites nothing.

## Rollback

Worth reverting only with the API that reads it also reverted, since that API selects the column. Dropping it loses each chapter's choice.

```sql
alter table public.chapters drop column if exists members_can_change_name;
```
