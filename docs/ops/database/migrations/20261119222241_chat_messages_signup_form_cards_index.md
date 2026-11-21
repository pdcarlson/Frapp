# 20261119222241_chat_messages_signup_form_cards_index.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds partial indexes for sign-up and form cards so `GET /v1/activity` stops scanning every chat message on each load (asked by Paul, 2026-11-19, #5658).

## Promotion

- **Purpose**: adds `idx_chat_messages_signup_cards` and `idx_chat_messages_form_cards` on `chat_messages (created_at desc)`, partial on `kind = 'signup'` and `kind = 'form'` with `is_deleted = false`, the same shape as `idx_chat_messages_poll_cards` (#3897). Activity's `findCardsByChapter` reads for those two kinds ran as sequential scans of the whole table (about 45k rows on production, mostly imported archives). Index only: no data or behaviour changes.
- **Checks**: after `db push`, this returns two rows:

  ```sql
  select indexname from pg_indexes
   where indexname in ('idx_chat_messages_signup_cards', 'idx_chat_messages_form_cards');
  ```

  `explain` of `select id from chat_messages where kind = 'form' and is_deleted = false order by created_at desc limit 100` names `idx_chat_messages_form_cards` instead of a Seq Scan.
- **Promoter notes**: schema only, no data written, any order against the API. The build holds a short write lock on `chat_messages` while it reads the table once; at 45k rows that is well under a second.

## Rollback

Nothing depends on these indexes for correctness: Activity only gets slower without them. Revert only if they cause a problem, with a forward migration:

```sql
drop index if exists public.idx_chat_messages_signup_cards;
drop index if exists public.idx_chat_messages_form_cards;
```
