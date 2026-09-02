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
  "branding": { "greek_letters": "ΣΦΕ", "designation": "California Eta", "school_short": "UCLA", "colors": { "accent": "#C9A56F" } },
  "theme_palette": { "--signet-accent-primary": "#...", "--signet-accent-text": "#...", ... },
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
- **`branding`** — Greek letters, designation, school short, founded year, and the accent seed (`colors.accent`). A second colour, `colors.dark`, existed until the #920 slice-9 cutover; it fed only the deleted legacy token map, and a row written before then keeps an inert value that no reader looks at.
- **`enabled_modules`** — the per-module on/off map (see [`spec/product/modules.md`](../product/modules.md)).

## PATCH /chapters/current — core chapter profile

Settings → Organization → "Chapter profile" does **not** go through the config PATCH above. The four core `chapters` columns — `name`, `university`, `donation_url`, `accent_color` — are written by `PATCH /v1/chapters/current`, guarded by `roles:manage` **or** `billing:manage`.

`accent_color` sits here rather than under `branding` despite reading as branding: the accent editor posts to this route, and the write mirrors the value into `branding.colors.accent` (authoritative per [`spec/behavior/branding.md`](branding.md)) and recomputes `theme_palette` in the same statement, so the two stores cannot diverge.

**Audit.** A save writes one `chapter_audit_log` row with action `chapter_profile_updated`, `target_type` `chapter`, `member_visible: true`, and a `diff` of `{ field: { from, to } }` — the same shape the config PATCH uses, so `#chapter-audit` renders both identically. This closes the Chunk 06 gap where the brief's "saving any Org field writes one audit row" held for config-backed fields only (#486).

Two properties of this writer differ from the config PATCH, deliberately:

- **Only changed fields appear in the `diff`**, and **a save that changes nothing writes no row at all.** The Settings form re-sends every stored value on save, so an unconditional write — which is what the config PATCH does — would mirror a "chapter profile updated" message into the member-visible `#chapter-audit` channel every time an officer opened Settings and pressed Save without editing anything.
- The row is written **after** the update lands, so a failed save leaves no audit row claiming it happened. A failure of the audit write itself surfaces as a `500` rather than being swallowed: a chapter mutation is never silently unaudited.

## POST /chapters/:id/theme-palette

Recomputes the derived palette from `branding.colors.accent` via `buildChapterPalette`, persists to `chapters.theme_palette`, and returns the full token map. Triggered automatically by PATCH when `branding.colors` changes. The derivation and role map are canon in [`spec/ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md); where the palette lives and who writes it is in [`spec/architecture/README.md`](../architecture/README.md).

## Dues configuration

Dues live in a singleton `chapter_dues_config` row per chapter (PK `chapter_id`), edited through chapter config:

- `cadence` — monthly / per-semester / per-quarter.
- `active_amount_cents`, `new_member_amount_cents`, `alumni_amount_cents` — per-tier amounts (non-negative integer cents).
- `installments_allowed` (+ installment count when allowed), `late_fee_cents`, `grace_days`, `scholarship_pool_cents`.

All cents fields are validated as non-negative integers (no `NaN`, no negatives — see [`spec/engineering.md`](../engineering.md)). A write to dues config produces a `chapter_audit_log` row and a `#chapter-audit` message like every other config change.

## GET /chapter-directory/search

Directory search backs the onboarding autofill. `GET /chapter-directory/search?q=...&university=...` returns the top matches from `chapter_directory` (Greek org letters/name + university, with default colors and identity fields) for the wizard to pre-fill chapter identity. Backed by indexes on `(university_short, org_letters)` and full-text on the combined name. Directory rows are public chapter identities, not personal data.
