# 20261114003444_chat_latest_message_gif.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `has_gif` to `get_channel_latest_messages` and to the thread card's `thread_last_reply`, so a GIF as a conversation's latest message, or as a thread's latest reply, previews as "GIF" (#4657).

## Promotion

- **Purpose**: `get_channel_latest_messages` is dropped and created again from `20261113185033_chat_message_forwarded_from.sql` with one more column, `has_gif boolean`: true when the latest message's `metadata.gif` is an object, false otherwise (never null). The GIF itself is not served. `chat_thread_reply_preview` (from `20261112121000_chat_thread_last_reply.sql`) is replaced in place with one more key, `has_gif`, so every trigger that calls it writes the flag from now on; a one-statement backfill adds `has_gif: true` to the parents whose held reply is already a GIF (the API accepted one before any client sent it).
- **Checks**:
  - `select count(*) from get_channel_latest_messages('<a chapter id>', '<a member id>');` runs, and the result has a `has_gif` column.
  - `select prosrc like '%has_gif%' from pg_proc where proname = 'chat_thread_reply_preview';` returns `t`.
- **Promoter notes**: the only write is the backfill, which touches only parents holding a GIF reply (likely none). Apply it before or after the API that reads the column: the API serving now passes the extra field through harmlessly, and the new API reads a missing one as false. The drop and create run in the migration's transaction, so no reader sees the function missing. Nothing is done by hand.

## Rollback

Rarely worth it: the column and the key are additive. If needed, revert the API first, then run a forward migration that redefines `get_channel_latest_messages` from `20261113185033_chat_message_forwarded_from.sql` (drop it first, since its return type changes) and `chat_thread_reply_preview` from `20261112121000_chat_thread_last_reply.sql`. A `has_gif` key left in a stored preview is ignored by older clients.

```sql
drop function if exists public.get_channel_latest_messages(uuid, uuid);
-- Then the create, revoke and grant statements of section 3 of
-- 20261113185033_chat_message_forwarded_from.sql, verbatim, and the
-- create or replace of chat_thread_reply_preview from section 1 of
-- 20261112121000_chat_thread_last_reply.sql.
```
