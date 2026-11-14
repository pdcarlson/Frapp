# 20261114003341_chat_member_threads.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `get_member_threads`, the read behind chat's All threads view (#4960).

## Promotion

- **Purpose**: one service-role function that lists the threads a member follows or muted across the channels the API has authorized, newest activity first, with each thread's latest reply id and new-reply count. No table or data changes.
- **Checks**: `select proname from pg_proc where proname = 'get_member_threads';` returns one row, and `select has_function_privilege('authenticated', 'public.get_member_threads(uuid, uuid, uuid[], integer)', 'execute');` is false.
- **Promoter notes**: additive; push before or with the API that calls it (`GET /v1/threads`). An API without the function answers that route with a 500 and nothing else.

## Rollback

Not worth reverting on its own: nothing else depends on the function. To remove it, a forward migration:

```sql
drop function if exists public.get_member_threads(uuid, uuid, uuid[], integer);
```
