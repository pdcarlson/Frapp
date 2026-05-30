# Settings: Customization Tabs

Behavior rules for the customization-heavy settings tabs (Theme, Roles, Fields, Workflows, Dues). The settings rail, Org/Modules tabs, and cross-cutting audit rules live in [`README.md`](README.md). Every save in any of these tabs writes a `chapter_audit_log` row mirrored to `#chapter-audit` (see the audit rules in the README).

## Theme Tab

- A chapter sets two colors: **dark** (sidebar / headers) and **accent** (chat self-bubble, mentions, CTAs). Accent-color rules and brand boundaries are canon in [`../branding.md`](../branding.md).
- Saving recomputes the chapter's `theme_palette` **server-side** and the client refetches and re-applies CSS variables immediately — no full reload.
- **WCAG enforcement:** a token that fails AA 4.5:1 against the background surfaces an inline warning. The save still succeeds, falling back to the safe tokens. Contrast derivation is archetype-agnostic.

## Roles Tab

- **Pack** (read-only): the active archetype's role pack. Assigning members to roles happens in the member directory, not here.
- **Matrix:** the capabilities × roles permission matrix. Its **columns derive from the active role pack at render time** (with a guarded fallback to archetype-default keys), never a hardcoded column array. Adding a custom role must extend the matrix columns with no code change.
- **Custom:** create and edit `chapter_custom_roles`. Each custom role carries: label, rank, capabilities (multi-select from the permission catalog), and a `core` flag — a non-core role can be deleted.

## Fields Tab

- An editable table over `chapter_custom_fields`. Each field has: label, type, `required`, **visibility** (`self` / `chapter` / `exec` / `president`), and a `sensitive` flag.
- Add-field configuration is type-specific (text → max length; select → options list; date → none; etc.).
- **Custom-field options lists are deep-cloned per chapter.** Editing one chapter's options must never mutate another chapter's options (no sharing of the seed reference).
- Visibility semantics are enforced when rendering the member directory — see [`../members.md`](../members.md) for the server-side enforcement rule.

## Workflows Tab

- A toggle list over `chapter_workflows`. Each enabled workflow may configure a numeric threshold, stored as `{ enabled, threshold }` on the workflow row.
- The **catalog** (key, label, default `enabled`, default `threshold`, `units`) is sourced from `WORKFLOWS_SEED` in `@repo/org-archetypes`; `chapter_workflows` holds only the per-chapter overrides. The merged view (catalog presentation overlaid with chapter `enabled`/`threshold`) is read via `GET /chapters/:id/config` (`workflows[]`) and written via `PATCH /chapters/:id/config` (`workflows: [{ key, enabled, threshold? }]`). No tab component writes the table directly — the config endpoint is the only path, and it audit-logs the change (mirrored to `#chapter-audit`) like every other settings save.
- The PATCH validates each `key` against the catalog (an unknown key is ignored, never written) and persists only changed rows. `threshold` **guard-parses**: a value is committed only when it parses to a nonnegative integer; an invalid, negative, or empty intermediate value preserves the previous value, and `NaN` is never stored. The threshold input is shown only while its workflow is enabled.

## Dues Tab

- Writes a singleton `chapter_dues_config` row per chapter.
- Cadence is one of: monthly / per-semester / per-quarter.
- Amounts are configured per member class: active member, new member, alumni.
- Conditional configuration: installments allowed (toggle + count), grace period (days), late fee (cents), scholarship pool (cents).
- **All numeric inputs guard-parse.** A value is committed only when it parses to a finite number `>= 0`; an invalid intermediate value preserves the previous value. Storing `NaN` is forbidden. Applies to every numeric input above (cadence amounts, installment count, grace days, late fee cents, scholarship pool cents).
