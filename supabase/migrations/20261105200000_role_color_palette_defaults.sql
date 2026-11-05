-- Move seeded system roles onto the role color palette (#3485).
--
-- Role colors now come from a fixed palette that stays readable on Frapp's
-- charcoal surfaces (`ROLE_COLOR_PALETTE` in packages/validation). The old
-- seeds do not: `#FFD700` sat beside the reserved house gold, `#10B981` was a
-- raw Tailwind emerald, and `#6B7280` read at 3.1 to 3.9:1, below AA for text.
-- Clients paint only palette values, so the old seeds would otherwise show as
-- no color at all.
--
-- Only system roles still on their pre-#3485 seed are rewritten: President,
-- Treasurer and Alumni on their old hex, and Vice President and Secretary still
-- null. A null cannot tell "never set" from "cleared on purpose", so a chapter
-- that cleared VP or Secretary through the API would get the default too. The
-- web picker never sent a clear, so in practice a null here was never set.
-- Member and New Member stay null. A color a chapter chose, and every custom
-- role (system_key null), is left alone.
--
-- On 2026-11-05 frapp-staging and frapp-prod each held two chapters, every
-- system role still on its seed and no custom role with a color.
--
-- The values match DEFAULT_SYSTEM_ROLES in
-- apps/api/src/domain/constants/permissions.ts, which seeds new chapters.

update public.roles as r
set color = v.new_color
from (
  values
    ('PRESIDENT', '#FFD700', '#F2994A'),
    ('TREASURER', '#10B981', '#6FD08C'),
    ('VICE_PRESIDENT', null, '#8FA8FF'),
    ('SECRETARY', null, '#F47FA4'),
    ('ALUMNI', '#6B7280', '#A9B4C2')
) as v(system_key, old_color, new_color)
where r.system_key = v.system_key
  and r.is_system = true
  and r.color is not distinct from v.old_color;
