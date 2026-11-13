# 20261113185033_chat_message_forwarded_from.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `chat_messages.forwarded_from`, the copy a forwarded message carries of its original (#4864, step 4 of #3723). It also adds the triggers that blank a copy when its original is deleted, puts the copy on Chat home's preview RPC, and makes `anonymize_user` rewrite a deleted member's name in copies of their messages.

## Promotion

- **Purpose**: a forward is an ordinary text message whose `forwarded_from` jsonb holds `message_id`, `channel_id`, `sender_id`, `author_name`, `content`, `gif`, `attachment_count` and `created_at` of the original, built by the API. Two triggers (`chat_messages_blank_forwards_on_soft_delete`, after `is_deleted` turns true, and `chat_messages_blank_forwards_on_delete`, per statement after a hard delete) reduce every copy of a deleted original to `message_id`, `channel_id`, `created_at` and `deleted: true`, so nothing a member deletes survives in a copy. A partial expression index on `forwarded_from ->> 'message_id'` serves those triggers. `get_channel_latest_messages` is dropped and created again with a `forwarded_from` column, which is withheld (`sender_blocked: true`) when the caller blocked the original's author. `anonymize_user` is redefined in full from `20261113181721_member_nudges.sql`, adding one update under its rescan gate.
- **Checks**:
  - `select count(*) from chat_messages where forwarded_from is not null;` returns 0 right after the push.
  - `select tgname from pg_trigger where tgname like 'chat_messages_blank_forwards%';` returns both triggers.
  - `select indexname from pg_indexes where indexname = 'idx_chat_messages_forwarded_from_message';` returns one row.
  - `select count(*) from get_channel_latest_messages('<a chapter id>', '<a member id>');` runs, and the result has a `forwarded_from` column.
  - `select prosrc like '%forwarded_from%' from pg_proc where proname = 'anonymize_user';` returns `t`.
- **Promoter notes**: no backfill, and every existing row stays null. Apply it before the API that writes forwards and reads the new RPC column. The API that is serving now ignores the extra column, so the order is safe. The index is built inline over an empty partial set, and the RPC drop and create runs in the migration's transaction, so no reader sees the function missing. Nothing is done by hand.

## Rollback

Worth it only if a trigger faults deletes. Revert the API first, so nothing writes or reads forwards. Then run a forward migration. Dropping the column loses every forward's copy; those messages remain as their comments alone, and a forward with no comment reads empty.

```sql
drop trigger if exists chat_messages_blank_forwards_on_soft_delete on public.chat_messages;
drop trigger if exists chat_messages_blank_forwards_on_delete on public.chat_messages;
drop function if exists public.chat_messages_blank_forwards_on_soft_delete();
drop function if exists public.chat_messages_blank_forwards_on_delete();
drop function if exists public.chat_forward_snapshot_blanked(jsonb);
-- Then redefine get_channel_latest_messages from
-- 20261110220000_chat_message_threads.sql (drop it first: its return type
-- changes) and anonymize_user from 20261113181721_member_nudges.sql, before:
drop index if exists public.idx_chat_messages_forwarded_from_message;
alter table public.chat_messages drop column if exists forwarded_from;
```
