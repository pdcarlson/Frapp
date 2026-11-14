# 20261114153327_chat_message_reminders.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `chat_message_reminders`, the table behind "Remind me about this" on a chat message (#4957): one row per member per message, with when to remind and when the reminder fired. Makes `anonymize_user` delete a deleted account's reminders.

## Promotion

- **Purpose**: holds each member's private reminders on chat messages. The API's minute sweep claims a due row (sets `fired_at`) and sends the push; the row then shows on the member's Activity page until they mark it done, which deletes it. RLS on and no policies: the API is the only reader and writer.
- **Checks**:
  - `select count(*) from chat_message_reminders;` runs and returns 0.
  - `select relrowsecurity from pg_class where relname = 'chat_message_reminders';` returns `t`.
  - `select prosrc like '%chat_message_reminders%' from pg_proc where proname = 'anonymize_user';` returns `t`.
- **Promoter notes**: additive, writes no data, and safe to apply before the API that uses it. Nothing by hand.

## Rollback

Worth it only if the table itself causes a fault. Revert the API first, then run a forward migration. Dropping the table loses members' pending reminders, which they would have to set again.

```sql
-- Redefine anonymize_user from 20261113185033_chat_message_forwarded_from.sql
-- first (it must stop naming the table), then:
drop table if exists public.chat_message_reminders;
```
