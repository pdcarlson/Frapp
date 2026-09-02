-- Default invite role configuration (#422): a chapter-chosen role that new
-- invites fall back to, instead of the admin re-picking one on every invite.
--
-- Additive and nullable. NULL means "no default configured", in which case
-- InviteService keeps the pre-existing behaviour and falls back to the seeded
-- Member system role, so every chapter created before this column keeps
-- working unchanged with no backfill.
--
-- The id is stored rather than the role NAME on purpose. `invites.role` is a
-- display-name string matched by name at redeem time, and a name stored here
-- would silently dangle when a role is renamed or deleted, quietly demoting
-- every subsequent invite to the Member fallback with nothing recording it.
-- `on delete set null` makes the deleted-role case structural: the default
-- clears itself, and the API reports "no default configured" rather than
-- pointing at a role that no longer exists.
--
-- Cross-chapter assignment is rejected in the API (ChapterConfigService
-- validates the role's chapter_id and 400s on a mismatch). A composite FK
-- cannot enforce it here without a redundant unique key on roles
-- (id, chapter_id); the service check is the control, and the
-- chapter-config route is the only writer.

alter table chapters
  add column if not exists default_invite_role_id uuid
    references roles (id) on delete set null;

-- FK lookup index: Postgres does not auto-index the referencing side, and
-- `on delete set null` scans this column on every role delete.
create index if not exists idx_chapters_default_invite_role_id
  on chapters (default_invite_role_id)
  where default_invite_role_id is not null;

comment on column chapters.default_invite_role_id is
  'Role new invites default to when the caller does not name one (#422). NULL = fall back to the seeded Member system role.';
