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
- **Promoter notes**: writes data (deletes rows). Deploy production migrates before the API rolls out, and until it does the older API still seeds a flagged `#chapter-audit` for any chapter created in that window (it sets `is_audit_log` itself, so dropping the trigger doesn't stop it). After the API is live, re-run the first check; if it isn't 0, re-run `delete from public.chat_channels where is_audit_log;`. #5808 repeats that delete before dropping the column either way.

## Rollback

Not worth reverting: the deleted lines were copies of `chapter_audit_log` rows, which the Logs page shows. To bring a channel back, revert the PR (the API seeds and mirrors again) and recreate the trigger from `20261109210000_chat_channels_is_audit_log.sql` in a forward migration; the old lines themselves come back only from a backup ([playbook](../../db-rollback-playbook.md#decision-matrix)).

```sql
-- Recreate the flag trigger: copy the function and trigger from
-- 20261109210000_chat_channels_is_audit_log.sql, then for each chapter:
-- insert into public.chat_channels (chapter_id, name, type, is_read_only, is_audit_log)
-- values (:chapter_id, 'chapter-audit', 'PUBLIC', true, true);
```
