-- #4043: remember on the account which What's new entry a member has seen,
-- so the update only opens by itself on the first device they open.
--
-- Until now each device kept its own marker (`localStorage` on the web,
-- AsyncStorage on the phone), so one update opened What's new on every
-- device. The column holds a `releaseNoteVersion` from `@repo/validation`
-- (`YYYY-MM-DD#lines`): web deploys at once and the phone updates later, so
-- the devices compare versions rather than a yes or no. `UserService` writes
-- it and only ever moves it forward.
--
-- Null = no device has recorded one yet (every account until a device on the
-- new build opens). Not PII: `anonymize_user` leaves it alone.
--   spec/ui/mobile/screens.md s16, spec/ui/web-dashboard/README.md § What's new

alter table users
  add column if not exists whats_new_seen_version text;
