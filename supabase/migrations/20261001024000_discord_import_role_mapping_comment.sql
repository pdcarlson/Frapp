-- #2887: give discord_imports.role_mapping a catalog comment that says what it
-- does now.
--
-- Comment-only: one COMMENT ON, no column, index, constraint, policy or row
-- change.
--
-- The column's `--` comment in 20260824120000_discord_import.sql calls the
-- mapping informational: nothing reads it to grant a permission, the importer
-- never assigns a role, and each entry carries a `signet_role`. Since #2818
-- (20260928203000_discord_import_role_gates.sql) each entry names the Frapp
-- role a Discord role becomes, the mapping gates the private channels imported
-- "Same as Discord", and starting the import creates the new roles and grants
-- their read permissions (DiscordImportService.setRoleMapping and
-- provisionRoles). It still never assigns anyone to a role. The entry shape is
-- DiscordRoleMapping in apps/api/src/domain/entities/discord-import.entity.ts.
--
-- That migration is promoted and is not edited in place (its successor's
-- header, 20260824120000, set the precedent for the dedupe-index comment in
-- 20260823120000; whether shipped comments may ever be edited is #1409). The
-- column had no catalog comment, so this adds one where `\d+` shows it, and
-- the promotion runbook's 20260824120000 entry points here.

comment on column public.discord_imports.role_mapping is
  'Discord role -> Frapp role mapping (#2818). Each entry names the Frapp role a Discord role becomes (existing, new, or ignore). It gates the channels imported "Same as Discord", and starting the import creates the new roles and grants their read permissions. It never assigns anyone to a role. Shape: DiscordRoleMapping in apps/api/src/domain/entities/discord-import.entity.ts.';
