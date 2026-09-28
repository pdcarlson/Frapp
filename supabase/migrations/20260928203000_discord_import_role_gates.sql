-- Discord roles gate the imported private channels (#2818).
--
-- Owner decision, 2026-09-28: a channel that was private in Discord defaults
-- to "Same as Discord", readable in Frapp only by the Frapp roles mapped from
-- the Discord roles that could read it there. Until now the Discord -> Frapp
-- role mapping was a worksheet that granted nothing, and the admin chose each
-- private channel's readers by hand. Two columns carry the new rule:
--
--   discord_reader_role_ids      the scan's fact: the Discord roles that could
--                                read the channel's history, each on its own,
--                                leaving out @everyone and the managed roles
--                                Discord gives bots and boosters. Set for a
--                                top-level channel that was private in
--                                Discord, and empty when @everyone alone
--                                could read it (a deny hid it from someone);
--                                null otherwise, when the roles could not be
--                                read, and on the upload path, whose export
--                                carries no permissions.
--   new_channel_same_as_discord  the admin's choice: the new channel is
--                                ROLE_GATED on the read permissions of the
--                                Frapp roles mapped from those Discord roles.
--                                The API resolves them into
--                                new_channel_required_permissions when the
--                                channels are mapped, so the worker creates
--                                the channel exactly as it creates any other
--                                ROLE_GATED one.
--
-- The role mapping itself stays in discord_imports.role_mapping (jsonb), whose
-- entries now say which Frapp role each Discord role becomes (an existing
-- one, a new one, or none). Starting the import creates the new roles and
-- grants the read permissions. It never assigns anyone to a role.
--
-- Both columns are nullable or defaulted, so existing rows are untouched:
-- nothing mapped before this migration is "Same as Discord".

alter table public.discord_import_channels
  add column if not exists discord_reader_role_ids text[],
  add column if not exists new_channel_same_as_discord boolean not null default false;

-- "Same as Discord" is a way of choosing a ROLE_GATED channel, never another
-- type, so the gate the worker reads is always the non-empty permission list
-- that discord_import_channels_new_channel_type_check already requires.
alter table public.discord_import_channels
  drop constraint if exists discord_import_channels_same_as_discord_check;
alter table public.discord_import_channels
  add constraint discord_import_channels_same_as_discord_check check (
    not new_channel_same_as_discord or new_channel_type = 'ROLE_GATED'
  );
