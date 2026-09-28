-- Visibility for the channels a Discord import creates, and what the bot could
-- see when it scanned (#2787).
--
-- Until now every "New channel" an import created was PUBLIC: readable by the
-- whole chapter. A Discord server keeps its exec, bid and committee channels
-- hidden from @everyone, so importing one that way published it chapter-wide,
-- and nothing in the wizard said so. Two facts from the scan, and one choice
-- from the admin, close that:
--
--   readable            could the bot read this channel's history when it
--                       scanned? False means Discord hides it from the bot
--                       (a channel-level View Channels / Read Message History
--                       deny it holds no role to override). Null means the
--                       scan could not tell, as on the upload path, which has
--                       no permissions to read.
--   private_in_discord  was it private in Discord (some member could not read
--                       its history)? The API refuses to create such a
--                       channel in Frapp, or one whose privacy is unknown,
--                       unless the admin chose its visibility explicitly.
--   new_channel_type    PUBLIC (whole chapter) or ROLE_GATED (members holding
--                       one of new_channel_required_permissions). The same two
--                       values chat_channels.type takes for them.
--
-- All nullable or defaulted, so existing rows are untouched. An upload has no
-- permissions to read, so its new channels always carry an explicit choice.

alter table public.discord_import_channels
  add column if not exists readable boolean,
  add column if not exists private_in_discord boolean,
  add column if not exists new_channel_type text not null default 'PUBLIC',
  add column if not exists new_channel_required_permissions text[];

-- Mirrors chat_channels: a ROLE_GATED channel that gates on nothing is denied to
-- everyone but a President (FRA-321), so the import must never create one.
-- Checked here because the worker reads these rows directly, thousands of rows
-- into an import, where a bad row would surface as a failed channel create.
alter table public.discord_import_channels
  drop constraint if exists discord_import_channels_new_channel_type_check;
alter table public.discord_import_channels
  add constraint discord_import_channels_new_channel_type_check check (
    new_channel_type in ('PUBLIC', 'ROLE_GATED')
    and (
      new_channel_type <> 'ROLE_GATED'
      or coalesce(array_length(new_channel_required_permissions, 1), 0) > 0
    )
  );
