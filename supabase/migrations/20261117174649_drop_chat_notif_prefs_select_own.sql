-- Drop the chat_notification_preferences select policy that never matched (#4839).
--
-- `chat_notification_preferences_select_own` (20260527120000) found the caller
-- with `user_id in (select id from users where supabase_auth_id = auth.uid())`.
-- `users` is default-deny to the client roles, so inside the policy that
-- subselect sees no rows and the policy matched nothing: the same dead pattern
-- 20261112280000 removed from chat_message_actions (#724). It failed closed,
-- so nothing leaked.
--
-- No client reads this table. The API reads and writes it as service_role
-- (`ChatNotificationPreferenceService`), behind ChapterGuard. A working
-- select-own policy would open a read path nothing uses, and one with no
-- chapter check: a member removed from a chapter keeps their rows there.
-- authorization-model.md § Consequence for anyone adding a table: a client
-- policy needs a client that reads the table. So the table goes back to plain
-- default-deny, which is what it already did in practice.
--
-- Locks: one policy dropped on chat_notification_preferences (a brief ACCESS
-- EXCLUSIVE on the table). No rows are read or written.

drop policy if exists "chat_notification_preferences_select_own"
  on public.chat_notification_preferences;
