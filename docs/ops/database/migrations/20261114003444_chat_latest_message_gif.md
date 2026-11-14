# 20261114003444_chat_latest_message_gif.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `has_gif` to `get_channel_latest_messages`, so a GIF as a conversation's latest message previews as "GIF" in the Messages list (#4657).

## Promotion

- **Purpose**: `get_channel_latest_messages` is dropped and created again from `20261113185033_chat_message_forwarded_from.sql` with one more column, `has_gif boolean`: true when the latest message's `metadata.gif` is an object, false otherwise (never null). The GIF itself is not served.
- **Checks**:
  - `select count(*) from get_channel_latest_messages('<a chapter id>', '<a member id>');` runs, and the result has a `has_gif` column.
- **Promoter notes**: no data is written. Apply it before or after the API that reads the column: the API serving now ignores the extra column, and the new API reads a missing one as false. The drop and create run in the migration's transaction, so no reader sees the function missing. Nothing is done by hand.

## Rollback

Rarely worth it: the column is additive and read-only. If needed, revert the API first, then run a forward migration that redefines the function from `20261113185033_chat_message_forwarded_from.sql` (drop it first, since its return type changes).

```sql
drop function if exists public.get_channel_latest_messages(uuid, uuid);
-- Then the create, revoke and grant statements of section 3 of
-- 20261113185033_chat_message_forwarded_from.sql, verbatim.
```
