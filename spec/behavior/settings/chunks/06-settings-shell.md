# Chunk 06 — Settings shell + Org + Modules tabs

**Depends on:** Chunk 02 (chapter_config API), Chunk 05 (audit → `#chapter-audit` bridge).
**Unblocks:** 07, 08.

## Read first

1. `spec/redesign-context.md` — *Module catalog (revised)*, *Module gating*.
2. `design-handoff/project/settings.jsx` and `design-handoff/project/settings*.jsx` (landed in Chunk 01) — visual reference for the rail layout.
3. Existing settings to replace: `apps/web/components/settings/settings-page.tsx`.
4. `apps/web/lib/hooks/use-org-config.ts` (Chunk 02) — settings tabs write through this.
5. **`spec/redesign-context.md` → *Engineering principles*.** Non-negotiable for every chunk; the bullets below are this chunk's specific applications.

## Engineering principles applied here

- **Org tab archetype rendering uses the `getArchetype()` helper from Chunk 02,** never `ARCHETYPES[org.archetype]` directly. The helper returns the `ifc` fallback when the key is missing/unknown so the settings pane never crashes on a stale or in-flight `org.archetype` value. The prototype's `settings-org.jsx` reads `window.ORG_ARCHETYPES[org.archetype]` with no guard — do not port that pattern.
- **Settings rail tabs are semantic interactives** — `<button>` if the active tab is tracked in client state, `Link` if it's URL-routed. No `<div onClick>`. Active styling stays the same.
- **`enabled_modules` is a boolean map** (`Record<string, boolean>`, as shipped by Chunk 02 — see `PatchChapterConfigSchema`). The Modules tab therefore renders **on/off toggles** labelled **Free** (always-on, locked) vs **Chapter Pro** (the single paid tier). There is no per-module price and no `trialEndsAt` field; module trial-countdown copy is deferred to a follow-up that first adds a module-trial data model.
- **`enabled_modules` writes go through the `usePatchOrgConfig()` mutation** which optimistically updates the cache, calls the cold-path PATCH, and rolls back on error. No direct `supabase.from(...).update(...)` from the tab component.

## Branch

`claude/redesign-chunk-06-settings-shell` — from `main`.

## Goal

Rebuild `/settings` with the 9-tab rail (Org, Modules, Roles, Fields, Workflows, Dues, Theme, Beta, Audit) and ship the first two tabs end-to-end: **Org** (identity + archetype + vocabulary) and **Modules** (toggle integrations on/off). The remaining tabs are stubs to be filled by Chunks 07–08, except **Theme**, which preserves the pre-redesign accent-color control so branding editing does not regress (full chapter-palette UX lands in Chunk 07).

## Tasks

1. **Rail layout** per `design-handoff/project/settings.jsx`. Tabs: Org, Modules, Roles, Fields, Workflows, Dues, **Theme** (new vs design — chapter colors UX), Beta, Audit.
2. **Org tab:**
   - Identity form: name, university, Greek letters, designation, school short, founded year, donation URL.
   - Archetype picker (all 8 archetypes in a 4-up grid, rendered via `getArchetype()`) with a confirm dialog warning that the switch resets modules, role pack, and vocabulary to the new archetype's defaults (identity, branding, and custom fields are kept).
   - Vocabulary 3-input: pledge/aspirant/candidate term, rush/recruitment/intake term, class/line/cohort term.
3. **Modules tab:**
   - Always-on modules locked at the top, labeled "Free."
   - Paid modules: each row shows a **Chapter Pro** badge and an on/off toggle wired to `chapter_config.enabled_modules[key]`. Expandable rows list sub-features (informational in Chunk 06; per-feature toggles land in Chunk 07).
   - Disabling a module immediately:
     - Hides its nav item. (Chunk 04 did **not** ship `<ModuleGatedNavItem>`; Chunk 06 wires module-gating via `NavItem.module` + `ProtectedNavItem` reading `useOrgConfig().isModuleEnabled`.)
     - Removes its slash commands from the chat palette.
     - Mutes its system channel (does not delete it — re-enabling restores).
4. **Audit-write on every save:** every PATCH writes a row to `chapter_audit_log` (member_visible = true) which posts to `#chapter-audit` via the Chunk 05 bridge.
5. **Spec updates** — `spec/ui-web-dashboard.md` (settings rail + Org tab + Modules tab spec), `spec/product/modules.md` (module catalog table).

## Verification

- [ ] Switch archetype on a test chapter from IFC to NPC → vocabulary defaults update (rush → recruitment) and role pack swaps in. An audit message appears in `#chapter-audit`.
- [ ] Disable the Events module → `/event` slash command disappears from the chat palette on next focus.
- [ ] Re-enable Events → `/event` returns.
- [ ] Saving any Org field writes one audit row visible in the audit feed.
- [ ] Two-archetype check: repeat the disable/enable test on an NPHC chapter to confirm vocabulary applies consistently.
- [ ] Screenshots: settings shell with rail visible, Org tab populated, Modules tab with one module enabled and one disabled.

> **Sandbox note (#401):** the live checks above that require the Supabase hot path — the `#chapter-audit` message appearing after a config save/archetype switch, and a slash command disappearing live — cannot be exercised in the cloud-agent sandbox. They are covered by the audit-bridge Jest suite (merged in Chunk 05) plus the web component/hook tests added here, and are marked blocked on #401 in the PR rather than silently checked.

## Handoff

- Branch `claude/redesign-chunk-06-settings-shell`. PR title `Chunk 06 — Settings shell + Org + Modules`.
- Move the issue to *In Review* on the *Frapp Launch* GitHub project.
