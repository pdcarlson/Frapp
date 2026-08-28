-- FRA-320: give system roles a stable, rename-proof key.
--
-- The Alumni lifecycle restrictions (spec/behavior/alumni.md) and the
-- President / Member system-role lookups all resolved roles by `roles.name`,
-- which chapters are free to rename (`RbacService.update` blocks deleting a
-- system role, never renaming it). A rename silently disabled enforcement
-- chapter-wide with no error and no log line, and reattaching a freed name to
-- another role transferred the restrictions to its holders instead.
--
-- `system_key` is the rename-proof identity those lookups key on from here on.
-- `name` becomes purely a display label.
--
-- Additive only: one new nullable column plus a partial unique index. No
-- existing column, constraint, or policy is altered and no row is deleted.

alter table roles
  add column if not exists system_key text;

comment on column roles.system_key is
  'Stable identifier for seeded system roles (PRESIDENT, TREASURER, VICE_PRESIDENT, SECRETARY, MEMBER, NEW_MEMBER, ALUMNI). Null for custom roles. Not writable through the API - authorization and lifecycle lookups key on this instead of name, which chapters may rename freely.';

-- Backfill existing chapters from the current name. A chapter that has already
-- renamed a system role gets no key and keeps today's fail-open behavior: the
-- original identity is not recoverable after the fact, and inferring it would
-- be a guess about intent. The guarantee established here is forward-looking --
-- renames from this point on cannot break enforcement.
update roles
set system_key = case name
  when 'President' then 'PRESIDENT'
  when 'Treasurer' then 'TREASURER'
  when 'Vice President' then 'VICE_PRESIDENT'
  when 'Secretary' then 'SECRETARY'
  when 'Member' then 'MEMBER'
  when 'New Member' then 'NEW_MEMBER'
  when 'Alumni' then 'ALUMNI'
end
where is_system = true
  and system_key is null;

-- At most one role per key per chapter. Partial, so the unbounded set of custom
-- roles (system_key null) stays unconstrained.
create unique index if not exists idx_roles_chapter_system_key
  on roles (chapter_id, system_key)
  where system_key is not null;
