-- Frapp AI on for the four tester accounts (#4790).
--
-- Paul, 2026-11-13: "assume that the 4 tester accounts have already given
-- consent because they're all developers right now". Consent is now given on
-- Meet Frapp AI during onboarding; these four production accounts (Paul,
-- Shawn, Winston and Evan, the developers in the "Phi Gamma Delta" test
-- chapter) are recorded as having said yes on the current version (2), so
-- they are not asked. Two of them already said yes on version 2; `on conflict
-- do nothing` keeps their own answer and its time.
--
-- The ids are production's. On any other database (staging, a local stack,
-- CI) none of them exists, so the `join` on `users` makes this a no-op there.
-- `user_ai_consents` is the API's only (RLS on, no policies); this runs as the
-- migration owner.
insert into public.user_ai_consents (user_id, sheet_version, accepted, answered_at)
select u.id, 2, true, now()
from public.users u
where u.id in (
  '937a39e8-17c1-4b1f-8b6c-ce1f358f5af2',
  '600a21dc-46dd-43b6-987e-fe6ef7d321fd',
  '3e177a65-7e66-41bb-8b38-0f28f2227714',
  'fe3877f1-44e3-40b6-b1b6-710cffea6ba9'
)
on conflict (user_id, sheet_version) do nothing;
