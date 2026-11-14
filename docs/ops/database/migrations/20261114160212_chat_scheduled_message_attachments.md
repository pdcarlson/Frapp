# 20261114160212_chat_scheduled_message_attachments.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Lets a scheduled chat message carry files, a quote reply or a thread reply (#4971).

## Promotion

- **Purpose**: adds `attachments` (jsonb list of uploaded file claims, default `[]`), `reply_to_id` and `thread_root_id` to `chat_scheduled_messages`, and lets `content` be empty when there are files, as a live send's may. At most one of the reply and the thread. No foreign keys on either: the API's send decides what a removed target means.
- **Checks**:
  - `select attachments, reply_to_id, thread_root_id from chat_scheduled_messages limit 1;` runs.
  - `select conname from pg_constraint where conrelid = 'public.chat_scheduled_messages'::regclass and not convalidated;` returns no rows.
- **Promoter notes**: additive, writes no data, and safe to apply before the API that uses it: the old API never writes the new columns, and every row it writes still passes the new checks. Nothing by hand.

## Rollback

Worth it only if the columns themselves cause a fault. Revert the API first. Dropping the columns loses the files, quotes and threads of messages scheduled but not yet sent (their uploaded objects stay in storage, unreferenced), and the old text check fails on any file-only row, so delete those first.

```sql
delete from public.chat_scheduled_messages where btrim(content) = '';
alter table public.chat_scheduled_messages
  drop constraint if exists chat_scheduled_messages_one_target,
  drop constraint if exists chat_scheduled_messages_attachments_list,
  drop constraint if exists chat_scheduled_messages_content_length;
alter table public.chat_scheduled_messages
  add constraint chat_scheduled_messages_content_length
    check (char_length(btrim(content)) between 1 and 10000);
alter table public.chat_scheduled_messages
  drop column if exists attachments,
  drop column if exists reply_to_id,
  drop column if exists thread_root_id;
```
