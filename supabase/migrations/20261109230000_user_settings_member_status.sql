-- A member's chosen status, and a custom status line, on their account (#3845).
--
-- Online, Idle, Do Not Disturb or Invisible, plus one short line ("At practice
-- till 6"), each with an optional time it ends. On `user_settings` so it
-- follows the member across devices, so account deletion's
-- `delete from user_settings` (`anonymize_user`) clears it with the rest of
-- their settings, and so the push fan-out, which already reads this row for
-- quiet hours, sees Do Not Disturb without another read.
--
-- An expired value stays stored until the member next sets that status or
-- line; the API reads a status or line whose end time has passed as Online /
-- no line.
alter table public.user_settings
  add column if not exists status text not null default 'online',
  add column if not exists status_expires_at timestamptz,
  add column if not exists custom_status text,
  add column if not exists custom_status_expires_at timestamptz;

-- Plain constraints, not NOT VALID then VALIDATE: the columns were just added
-- with `online` or null in every row, so no row can fail either check, and the
-- `add column` above already holds the table's exclusive lock until commit.
alter table public.user_settings
  drop constraint if exists user_settings_status_valid;
alter table public.user_settings
  add constraint user_settings_status_valid
  check (status in ('online', 'idle', 'dnd', 'invisible'));

alter table public.user_settings
  drop constraint if exists user_settings_custom_status_length;
alter table public.user_settings
  add constraint user_settings_custom_status_length
  check (custom_status is null or char_length(custom_status) <= 80);
