# 20261121001755_remove_chapter_audit_channel.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Deletes every chapter's `#chapter-audit` channel and the trigger that flagged one, because the record of officer changes moved to the Logs page in Chapter settings (Paul, 2026-11-21).

## Promotion

- **Purpose**: no chat channel carries `is_audit_log` any more, and `chat_channels_flag_audit_log` (trigger and function) is gone. The channel's messages were copies of `chapter_audit_log` rows, which this leaves untouched; the Logs page reads that table.
- **Checks**:
  - `select count(*) from chat_channels where is_audit_log;` returns 0.
  - `select count(*) from pg_trigger where tgname = 'chat_channels_flag_audit_log';` returns 0.
  - `select count(*) from chapter_audit_log;` returns the same number as before the push.
- **Promoter notes**: writes data (deletes rows). Deploy the API first or together: an older API still runs the audit mirror, which finds no flagged channel and logs at debug, so the order is safe either way. Nothing by hand.

## Rollback

Not worth reverting: the deleted lines were copies of `chapter_audit_log` rows, which the Logs page shows. To bring a channel back, revert the PR (the API seeds and mirrors again) and recreate the trigger from `20261109210000_chat_channels_is_audit_log.sql` in a forward migration; the old lines themselves come back only from a backup ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
-- Recreate the flag trigger: copy the function and trigger from
-- 20261109210000_chat_channels_is_audit_log.sql, then for each chapter:
-- insert into public.chat_channels (chapter_id, name, type, is_read_only, is_audit_log)
-- values (:chapter_id, 'chapter-audit', 'PUBLIC', true, true);
```
