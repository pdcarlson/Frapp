-- The zone a member's clock reads in, so a push can name an event's time the
-- way their phone would (2026-11-06).
--
-- "New Event / Chapter has been scheduled" told a member nothing they could
-- act on from a lock screen. A push now carries the event's day and time, and
-- the server renders that text before it knows which phone shows it, so it
-- needs each recipient's zone. `quiet_hours_tz` is not that: it is set only by
-- a member who saved quiet hours, and it can be a zone they chose on purpose.
--
-- Both clients send their device's or browser's zone on every API request
-- (`x-time-zone`), and the API records it here when it changes
-- (`TimeZoneSyncService`). Nullable: a member whose client has not reported one
-- yet falls back to `quiet_hours_tz`, then to a labelled zone.
--
-- On `user_settings` rather than `users` so account deletion's
-- `delete from user_settings` (`anonymize_user`) clears it with the rest of the
-- member's settings, and so the push fan-out, which already reads this row for
-- quiet hours, gets it without another read.
alter table public.user_settings
  add column if not exists time_zone text;

alter table public.user_settings
  drop constraint if exists user_settings_time_zone_length;
alter table public.user_settings
  add constraint user_settings_time_zone_length
  check (time_zone is null or char_length(time_zone) <= 100);
