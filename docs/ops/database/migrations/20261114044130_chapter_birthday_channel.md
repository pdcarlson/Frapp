# 20261114044130_chapter_birthday_channel.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `chapters.birthday_channel_id`, the channel the chapter's happy-birthday posts go to (#4959). Null, the default, means the chapter posts none.

## Promotion

- **Purpose**: a nullable foreign key to `chat_channels` with `on delete set null`, and a partial index over the chapters that set it, which the API's birthday sweep reads.
- **Checks**:
  - `select count(*) from chapters where birthday_channel_id is not null;` returns 0 right after the push.
  - `select indexname from pg_indexes where indexname = 'idx_chapters_birthday_channel';` returns one row.
- **Promoter notes**: no backfill and no data written. Apply it before the API that reads the column; the API serving now ignores it. The index is built inline over an empty partial set. Nothing is done by hand.

## Rollback

Worth it only if the column breaks something. Revert the API first, so the sweep stops reading it. Then run a forward migration; dropping it forgets every chapter's chosen channel.

```sql
drop index if exists public.idx_chapters_birthday_channel;
alter table public.chapters drop column if exists birthday_channel_id;
```
