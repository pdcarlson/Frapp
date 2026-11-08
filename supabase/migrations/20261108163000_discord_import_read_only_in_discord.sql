-- Whether a Discord channel was read-only there, recorded by the scan (#3697).
--
-- Every channel a Discord import created came out read-only in Frapp, where
-- only an `announcements:post` holder can post in one: the wizard never set
-- the read-only choice and sent the default, true. A chapter moving off
-- Discord was left with channels its members could read but not talk in.
--
-- From here on an imported channel is postable by whoever can read it, and is
-- read-only only when Discord took Send Messages away from a reader the
-- server otherwise let talk (an announcements-style channel). That is a scan
-- fact, like private_in_discord:
--
--   read_only_in_discord  true when the channel was read-only in Discord;
--                         false when it was not; null for a thread (it lands
--                         in its parent's channel), when the scan could not
--                         read the server's roles, and always on the upload
--                         path, which has no permissions to read.
--
-- Nullable, so existing rows are untouched. Channels an import already created
-- are not changed here; repairing them is a separate, reviewed data fix.

alter table public.discord_import_channels
  add column if not exists read_only_in_discord boolean;
