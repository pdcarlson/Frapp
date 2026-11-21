-- Members can change their own name (#5801, Paul 2026-11-21: a member kept
-- renaming himself to the president's name).
--
-- While false, `PATCH /v1/users/me` refuses a changed `display_name` from a
-- member who has finished joining this chapter, unless they hold
-- `roles:manage` here. Officers fix names through
-- `PATCH /v1/members/{id}/profile` (#4367) either way. Read and written only
-- by the API (chapter config PATCH, `chapter-config:manage`); spec:
-- spec/behavior/members.md § Profiles.
--
-- Default false: names start locked in every chapter, existing ones included,
-- and an officer turns renaming back on in Chapter settings.

alter table public.chapters
  add column if not exists members_can_change_name boolean not null default false;

comment on column public.chapters.members_can_change_name is
  'When false, members who finished joining cannot change their own display name (officers with roles:manage can). #5801.';
