# 20261113234732_chat_scheduled_messages.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Adds `chat_scheduled_messages`, the chat messages members schedule to send later (#4956).

## Promotion

- **Purpose**: one row per message a member scheduled. The API's minute sweep posts each due row into its channel as its author and deletes it; a row the author can no longer post stays as `failed` with a reason code until they delete it. Rows go with the chapter, the channel and the author's account. RLS is on with no policies: the API is the only reader and writer.
- **Checks**:
  - `select count(*) from chat_scheduled_messages;` runs and returns 0.
  - `select relrowsecurity from pg_class where relname = 'chat_scheduled_messages';` returns `t`.
  - `select count(*) from pg_policies where tablename = 'chat_scheduled_messages';` returns 0.
- **Promoter notes**: additive, writes no data, and safe to apply before the API that uses it. Nothing by hand.

## Rollback

Worth it only if the table itself causes a fault. Revert the API first, then run a forward migration. Dropping the table loses every message members have scheduled and not yet sent, which nothing else holds, so tell the chapter first.

```sql
drop table if exists public.chat_scheduled_messages;
```
