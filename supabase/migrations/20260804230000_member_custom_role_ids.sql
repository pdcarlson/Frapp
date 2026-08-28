-- FRA-229: wire chapter_custom_roles into RBAC enforcement (bridge model).
--
-- Members carry their assigned custom roles in `members.custom_role_ids`,
-- mirroring `members.role_ids` for live roles. The permission resolver
-- flattens those roles' `capabilities` alongside live-role permissions;
-- ids are resolved against the active chapter, so a stale or cross-chapter
-- id matches no row and contributes nothing. Additive only — no existing
-- column, table, or policy changes.

alter table members
  add column if not exists custom_role_ids uuid[] not null default '{}';
