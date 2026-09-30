-- How far a Discord import's deletion has got (#2944).
--
-- A purge deletes an import's messages 500 at a time, a slice a minute, so a
-- large import takes a long while: staging's 145,574-message import still had
-- about 139,700 left after its first several minutes. Until now nothing
-- recorded the progress, so an admin could not tell a purge that was working
-- from one that was stuck.
--
--   purged_messages  imported messages the purge has deleted so far.
--
-- The purge worker writes it in the same lock-guarded write that renews its
-- lease after each round, so reading it costs nothing: the alternative, a
-- count(*) over the import's remaining rows on every three-second poll, scans
-- up to the whole import each time. It accumulates across purge attempts, so a
-- failed purge that the admin deletes again carries on from where it stopped.
--
-- Not null with a default of 0, so every existing import reads as nothing
-- deleted yet. An import already purged keeps 0; the web shows it as deleted
-- by its status, never by this count.

alter table public.discord_imports
  add column if not exists purged_messages integer not null default 0;
