# 20261118173407_chat_dm_read_receipts.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Read receipts on direct messages: the member's switch, and a sent or read word on their own last message in a DM or group DM (#5519).

## Promotion

- **Purpose**: `user_settings.read_receipts` (boolean, not null, default `true`) holds each member's two-way Read receipts switch. `get_channel_latest_messages` is redefined from `20261114153147` with one more column, `read_status`: `sent` or `read` on a DM or group DM whose latest message is the caller's, null otherwise. Read means every other member's cursor is at or after the message, none of them turned receipts off, and none of them blocked the caller; a caller with receipts off always gets `sent`. Rule: `spec/behavior/chat/README.md` § Read Receipts → Shown to the sender.
- **Checks**: `select column_name, column_default from information_schema.columns where table_name = 'user_settings' and column_name = 'read_receipts';` returns one row defaulting to `true`. `select read_status from public.get_channel_latest_messages('<chapter>', '<user>') limit 1;` runs without error. `select has_function_privilege('authenticated', 'public.get_channel_latest_messages(uuid, uuid)', 'execute');` is false and the same for `service_role` is true.
- **Promoter notes**: Additive in effect, so either order against the API works: an API without this change ignores the new column, and an API with it reads a missing `read_status` as no status (`SupabaseChatMessageRepository.findLatestPerChannel`). The function's return type changes, so it is dropped and created again inside the migration's transaction, with its grants restated. Writes no data beyond the column default.

## Rollback

Worth it only if the new function body misbehaves (the Messages list is its one reader). Restore the previous body with a forward migration that redefines `get_channel_latest_messages` exactly as `20261114153147_chat_latest_message_gif.sql` does (drop it and create it again, with the same revoke and grant block). Leave the column: it is harmless with nothing reading it, and dropping it loses members' choices ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
-- A forward migration: paste section 1 of 20261114153147_chat_latest_message_gif.sql
-- (`drop function if exists public.get_channel_latest_messages(uuid, uuid);`
-- through its grant block). Keep user_settings.read_receipts.
```
