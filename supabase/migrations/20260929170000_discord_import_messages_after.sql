-- An optional date cutoff for a Discord bot import (#2858).
--
-- A chapter that does not want years of old history can import only the
-- messages sent after a date. The less history an import reads, the less
-- Discord media it copies and stores (#2848, #2830), and the sooner it ends.
--
--   messages_after  the cutoff; null imports all history.
--
-- Nullable with no default, so every existing import keeps importing all of
-- its history. The API sets it only when a bot import is first started, and a
-- restart keeps it: the channels already done and the ones still to go must
-- follow one rule. An upload sets its range when exporting instead
-- (DiscordChatExporter's --after), so the API refuses it there.

alter table public.discord_imports
  add column if not exists messages_after timestamptz;
