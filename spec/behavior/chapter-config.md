# Chapter Config Endpoints

Chapter configuration is the merge of **archetype defaults** with **per-chapter overrides**. Reads return the merged shape; every write records an audit row and mirrors a `system_audit` message into the chapter's `#chapter-audit` channel.

## GET /chapters/:id/config

Returns the merged chapter configuration: archetype defaults overlaid with per-chapter overrides.

**Auth:** Bearer JWT + `x-chapter-id` header (chapter membership required). Permission: `chapter-config:view`.

**Response shape:**

```json
{
  "id": "<chapter_id>",
  "org_archetype": "ifc",
  "archetype_meta": { "label": "IFC Fraternity", "short": "IFC", "description": "...", "council": "..." },
  "enabled_modules": { "chat": true, "events": true, "dues": false, ... },
  "vocabulary": { "recruitment": "Rush", "pledge": "New member", "class": "Pledge class" },
  "branding": { "greek_letters": "ΣΦΕ", "designation": "California Eta", "school_short": "UCLA", "colors": { "dark": "#4B0082", "accent": "#C9A56F" } },
  "theme_palette": { "--side-bg": "#...", "--side-accent": "#...", ... },
  "beta_config": { "enabled": true, "style": "sidebar_pill" },
  "role_pack": "ifc_standard"
}
```

## PATCH /chapters/:id/config

Updates chapter config fields. Writes a diff entry to `chapter_audit_log` and posts a `system_audit` chat message to `#chapter-audit`. Permission: `chapter-config:manage`.

The customizable sub-resources surfaced through chapter config (full schema in [`spec/architecture/README.md`](../architecture/README.md)):

- **`chapter_custom_fields`** — per-chapter member fields. `(key, label, type, required, visibility, sensitive, options, sort)`. `visibility ∈ {self, chapter, exec, president}`.
- **`chapter_custom_roles`** — `(key, label, rank, capabilities[], core)`. `core=false` roles can be deleted.
- **`chapter_workflows`** — `(key, enabled, threshold, params)`. Each enabled workflow can configure its numeric threshold.
- **`branding`** — Greek letters, designation, school short, founded year, and the two-color palette source (`colors.dark`, `colors.accent`).
- **`enabled_modules`** — the per-module on/off map (see [`spec/product/modules.md`](../product/modules.md)).

## POST /chapters/:id/theme-palette

Recomputes the derived palette from `branding.colors` via `derivePalette()`, persists to `chapters.theme_palette`, and returns the full token map. Triggered automatically by PATCH when `branding.colors` changes. The palette derivation algorithm and token map are specified in [`spec/architecture/README.md`](../architecture/README.md).

## Dues configuration

Dues live in a singleton `chapter_dues_config` row per chapter (PK `chapter_id`), edited through chapter config:

- `cadence` — monthly / per-semester / per-quarter.
- `active_amount_cents`, `new_member_amount_cents`, `alumni_amount_cents` — per-tier amounts (non-negative integer cents).
- `installments_allowed` (+ installment count when allowed), `late_fee_cents`, `grace_days`, `scholarship_pool_cents`.

All cents fields are validated as non-negative integers (no `NaN`, no negatives — see [`spec/engineering.md`](../engineering.md)). A write to dues config produces a `chapter_audit_log` row and a `#chapter-audit` message like every other config change.

## GET /chapter-directory/search

Directory search backs the onboarding autofill. `GET /chapter-directory/search?q=...&university=...` returns the top matches from `chapter_directory` (Greek org letters/name + university, with default colors and identity fields) for the wizard to pre-fill chapter identity. Backed by indexes on `(university_short, org_letters)` and full-text on the combined name. Directory rows are public chapter identities, not personal data.
