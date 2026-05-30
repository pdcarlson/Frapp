# Chapter Settings

The settings surface is the chapter's configuration home. It is organized as a **settings rail** with nine tabs: **Org, Modules, Roles, Fields, Workflows, Dues, Theme, Beta, Audit**. This file covers the cross-cutting behavior plus the **Org** and **Modules** tabs; the customization-heavy tabs (Theme, Roles, Fields, Workflows, Dues) are specced in [`customization.md`](customization.md).

Related canon lives in:

- [`../chapter-config.md`](../chapter-config.md) — `GET/PATCH /chapters/:id/config` endpoints.
- [`../rbac.md`](../rbac.md) — role lifecycle and permission catalog.
- [`../branding.md`](../branding.md) — chapter logo and accent color.
- [`../billing.md`](../billing.md) — dues invoicing.

## Org Tab

- Identity fields: name, university, Greek letters, designation, school short, founded year, donation URL.
- **Archetype** is selectable from the eight supported archetypes. Switching archetype **resets modules, role pack, and vocabulary** to the new archetype's defaults; identity, branding, and custom fields are kept. The switch is confirmed before applying because of the reset.
- Archetype lookups always resolve through the `getArchetype()` helper, which falls back to the `ifc` archetype when the stored key is missing or unknown. Settings must never crash on a stale or in-flight archetype value, and must never read an archetype map directly by key without that guard.
- **Vocabulary** is configurable per chapter via three substitutable terms: pledge/aspirant/candidate, rush/recruitment/intake, and class/line/cohort. All settings copy and downstream surfaces render the chapter's chosen term through the vocabulary helper rather than hardcoding "rush" or "pledge."

## Modules Tab

- `enabled_modules` is a boolean map (`Record<string, boolean>`). The tab renders per-module **on/off toggles**.
- Modules are labeled by tier: **Free** (always-on, locked on) or **Chapter Pro** (the single paid tier). There is no per-module price.
- `enabled_modules` writes go through the config PATCH mutation (optimistic update, rollback on error). No tab component writes directly to the database.
- **Disabling a module immediately:**
  - Hides its nav item (gated on `isModuleEnabled`).
  - Removes its slash commands from the chat palette.
  - Mutes its system channel — it is **not** deleted, so re-enabling restores it.
- Module state is read from chapter config, never from a `window.*` global.

## Audit Rules

- **Audit-write on save:** every settings PATCH (in any tab) writes a row to `chapter_audit_log`. Each audit row is created `member_visible = true` and is mirrored to the `#chapter-audit` channel via the audit bridge.
- The Audit tab presents a paginated, filterable table of `chapter_audit_log` rows (filter by actor, action type, date range), with per-row expansion of the change `diff`.
- **`member_visible` is togglable per row, president-only.** Toggling `member_visible` **off retracts** the corresponding `#chapter-audit` message for non-president members; toggling it back **on re-posts** it.
