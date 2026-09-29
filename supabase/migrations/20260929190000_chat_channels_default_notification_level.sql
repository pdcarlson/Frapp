-- An officer-set default push level for each chat channel (#2771).
--
-- The owner decided (2026-09-29, on #2771) that a channel's default level is
-- set by officers, like Discord's server default notification setting, and
-- that a member's own channel or kind preference always overrides it.
--
--   default_notification_level  'all' | 'mentions' | 'off'; null means no
--                               officer has chosen one.
--
-- Nullable with no default, so no row is written. Null resolves to the
-- built-in default (`builtInChannelDefault` in @repo/validation): 'all' for
-- #general, the announcements channel and DMs, 'off' for #chapter-audit,
-- 'mentions' for the rest. That rule is the "seeded" value the decision asks
-- for, so no backfill is needed. The push worker ignores this column on DMs
-- and group DMs, which have no officer, and the API refuses to set it there.

alter table public.chat_channels
  add column if not exists default_notification_level text;

-- Added NOT VALID, then validated: the column was just added and is null on
-- every row, so the validation scan finds nothing, and it runs under a lock
-- that does not block reads or writes.
alter table public.chat_channels
  add constraint chat_channels_default_notification_level_check
  check (default_notification_level in ('all', 'mentions', 'off')) not valid;

alter table public.chat_channels
  validate constraint chat_channels_default_notification_level_check;
