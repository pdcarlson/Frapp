# 20261117174649_drop_chat_notif_prefs_select_own.sql

Drops `chat_notification_preferences_select_own`, a client select policy whose `users` subselect saw no rows under RLS, so it never matched (#4839). The table is default-deny to clients, as it already was in practice.

## Promotion

- **Purpose**: `chat_notification_preferences` keeps RLS on with no policy, so only the API (service role) reads or writes it. No client reads the table, so nothing members see changes.
- **Checks**: `select count(*) from pg_policies where tablename = 'chat_notification_preferences';` returns 0, and `select relrowsecurity from pg_class where relname = 'chat_notification_preferences';` returns true.
- **Promoter notes**: no API change, no data written, any deploy order. Locks: a brief ACCESS EXCLUSIVE on `chat_notification_preferences` while the policy is dropped.

## Rollback

Not worth reverting: the dropped policy matched no rows, so putting it back changes nothing anyone can read. If a client ever needs to read the table directly, write a new policy that finds the caller through `chat_action_is_callers(user_id)` and checks chapter membership, rather than restoring this one. Restoring it as it was:

```sql
create policy "chat_notification_preferences_select_own"
  on public.chat_notification_preferences for select
  using (user_id in (select id from users where supabase_auth_id = auth.uid()));
```
