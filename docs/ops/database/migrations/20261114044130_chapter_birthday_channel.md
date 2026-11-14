# 20261114044130_chapter_birthday_channel.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `chapters.birthday_channel_id`, the channel the chapter's happy-birthday posts go to (#4959), null by default, which means the chapter posts none. Also adds `birthday_posts`, the claim that makes each post once per chapter, member and day.

## Promotion

- **Purpose**:
  - A nullable foreign key to `chat_channels` with `on delete set null`, and a partial index over the chapters that set it, which the API's birthday sweep reads.
  - `birthday_posts (chapter_id, user_id, local_date)`, its primary key, cascading from `chapters` and `users`, with RLS on and no policies. The sweep inserts a row before each post with `on conflict do nothing`, and only the insert that lands posts.
  - `users_clear_birthday_posts_on_tombstone`, an after-update trigger on `users` that deletes a tombstoned member's rows. Execute is revoked from `public`, `anon` and `authenticated`.
- **Checks**:
  - `select count(*) from chapters where birthday_channel_id is not null;` returns 0 right after the push.
  - `select indexname from pg_indexes where indexname = 'idx_chapters_birthday_channel';` returns one row.
  - `select count(*) from birthday_posts;` returns 0.
  - `select relrowsecurity from pg_class where relname = 'birthday_posts';` returns `t`.
  - `select tgname from pg_trigger where tgname = 'users_clear_birthday_posts_on_tombstone';` returns one row.
- **Promoter notes**: no backfill and no data written. Apply it before the API that reads the column; the API serving now ignores it. The index is built inline over an empty partial set. Nothing is done by hand.

## Rollback

Worth it only if the column breaks something. Revert the API first, so the sweep stops reading it. Then run a forward migration; dropping it forgets every chapter's chosen channel.

```sql
drop trigger if exists users_clear_birthday_posts_on_tombstone on public.users;
drop function if exists public.users_clear_birthday_posts_on_tombstone();
drop table if exists public.birthday_posts;
drop index if exists public.idx_chapters_birthday_channel;
alter table public.chapters drop column if exists birthday_channel_id;
```
