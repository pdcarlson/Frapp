# 20261115043715_activity_recap_pushes.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `activity_recap_pushes`, the claim that sends each member's weekly recap push once per chapter and week (#4985).

## Promotion

- **Purpose**:
  - `activity_recap_pushes (chapter_id, user_id, week_first_day)`, its primary key, cascading from `chapters` and `users`, with RLS on and no policies. The API's hourly recap sweep inserts a row before each push with `on conflict do nothing`, and only the insert that lands sends.
  - `users_clear_activity_recap_pushes_on_tombstone`, an after-update trigger on `users` that deletes a tombstoned member's rows, since account deletion tombstones the row and the cascade never fires. Execute is revoked from `public`, `anon` and `authenticated`.
- **Checks**:
  - `select count(*) from activity_recap_pushes;` returns 0 right after the push.
  - `select relrowsecurity from pg_class where relname = 'activity_recap_pushes';` returns `t`.
  - `select tgname from pg_trigger where tgname = 'users_clear_activity_recap_pushes_on_tombstone';` returns one row.
- **Promoter notes**: no backfill and no data written. Apply it before the API that writes it; the API serving now ignores it. Nothing is done by hand.

## Rollback

Worth it only if the table breaks something. Revert the API first, so the sweep stops writing it, then run a forward migration. Dropping it forgets which weeks were sent, so an API that sends again could repeat this week's push once.

```sql
drop trigger if exists users_clear_activity_recap_pushes_on_tombstone on public.users;
drop function if exists public.users_clear_activity_recap_pushes_on_tombstone();
drop table if exists public.activity_recap_pushes;
```
