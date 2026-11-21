# 20261114003341_chat_member_threads.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds the reads behind chat's All threads view (#4960), and moves the thread unread rule into one function both thread reads share.

## Promotion

- **Purpose**: three service-role functions: `chat_thread_unread_count` (the one copy of the new-reply rule), `get_member_thread_channel_ids` (the channels in a chapter holding a member's followed threads) and `get_member_threads` (those threads, newest activity first, with new-reply counts). `get_followed_thread_unread` is redefined on the shared rule with the same signature and answers. No table or data changes.
- **Checks**: `select proname from pg_proc where proname in ('chat_thread_unread_count', 'get_member_thread_channel_ids', 'get_member_threads');` returns three rows, and `select has_function_privilege('authenticated', 'public.get_member_threads(uuid, uuid, uuid[], integer)', 'execute');` is false. A channel's thread cards still show the same "N new" as before.
- **Promoter notes**: additive; push before or with the API that calls it (`GET /v1/threads`). An API without the function answers that route with a 500 and nothing else.

## Rollback

Not worth reverting on its own. To remove the new reads, a forward migration that first restores `get_followed_thread_unread` from `20261110220000_chat_message_threads.sql` (its inline unread rule), then:

```sql
drop function if exists public.get_member_threads(uuid, uuid, uuid[], integer);
drop function if exists public.get_member_thread_channel_ids(uuid, uuid);
drop function if exists public.chat_thread_unread_count(uuid, uuid, uuid, timestamptz);
```
