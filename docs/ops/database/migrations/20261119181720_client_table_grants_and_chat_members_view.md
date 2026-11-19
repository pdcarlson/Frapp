# 20261119181720_client_table_grants_and_chat_members_view.sql

<!-- One page per migration: its promotion entry and its rollback recipe.
     check:migration-safety reads the two headings below. Shared procedure
     lives in ../promotion.md and ../../db-rollback-playbook.md; link to it,
     don't copy it. -->

Narrows the table privileges the publishable key and signed-in clients hold, and makes the chat read rule require `members:view` as the chat routes do (asked by Paul, 2026-11-19).

## Promotion

- **Purpose**: `anon` holds no privilege on any `public` table, view or sequence. `authenticated` holds exactly `SELECT` on `chat_messages` and `SELECT`, `DELETE` on `chat_message_actions`. The default privileges for tables and sequences later migrations create are revoked for both roles. `can_read_chat_channel` (message and reaction reads, the `chat:channel:` Realtime topic) also requires a role in the chapter granting `members:view` or `*`. Function `EXECUTE` is unchanged.
- **Checks**: after `db push`, the first query returns exactly two rows (the ones in its comment) and the second returns one row holding `0`:

  ```sql
  select table_name, string_agg(privilege_type, ',' order by privilege_type)
    from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'authenticated'
   group by 1;  -- chat_message_actions DELETE,SELECT and chat_messages SELECT only
  select count(*) from information_schema.role_table_grants
   where table_schema = 'public' and grantee = 'anon';  -- 0
  ```

  Then open a chat channel on staging as a member: history loads, a reaction appears live on a second device, and removing your own reaction works.
- **Promoter notes**: no data written, and no API change needed: the API connects as service_role, which keeps its grants. Applies before or after the API deploy. Prod has no members yet.

## Rollback

Worth reverting only if a client read breaks, which means a direct read this PR missed. Grant that one privilege back in a forward migration rather than undoing the whole revoke. To undo everything (the earlier definition of `can_read_chat_channel` is in `20261113040007_chapter_groups.sql`; re-run it as a forward migration):

```sql
grant all on all tables in schema public to anon, authenticated;
grant usage, select, update on all sequences in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables to anon, authenticated;
alter default privileges in schema public grant usage, select, update on sequences to anon, authenticated;
-- The two revokes earlier migrations made, which the blanket grant above undoes
-- (20261112280000_chat_message_actions_client_writes, 20261113040007_chapter_groups):
revoke insert, update on public.chat_message_actions from anon, authenticated;
revoke all on public.chapter_group_memberships from anon, authenticated;
```

That restores the state before this migration, which let both roles `TRUNCATE` every other table outside RLS; prefer the single forward grant above.
