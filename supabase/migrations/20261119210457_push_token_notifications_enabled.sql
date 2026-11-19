-- Whether each registered phone lets Frapp's notifications show.
--
-- A phone can hold a push token with notifications turned off: iOS hands out
-- a device token without the member's permission, and Android 13+ gives an
-- FCM token without POST_NOTIFICATIONS. So a `push_tokens` row says the app is
-- signed in on that phone, not that a push will be seen. The phone reports
-- what its own push switch reads (`pushIsOn()` in
-- `apps/mobile/lib/notifications/push-state.ts`) with every register, and
-- officers see the result in the Directory.
--
-- Null means the phone has not said: a build from before this column, or a
-- read that failed. Nullable with no default, so the add is a catalog change
-- with no rewrite.
alter table public.push_tokens
  add column if not exists notifications_enabled boolean;
