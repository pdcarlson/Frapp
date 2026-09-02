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

`accent_color` sits here rather than under `branding` despite reading as branding: the accent editor posts to this route, and a save carrying a hex mirrors the value into `branding.colors.accent` (authoritative per [`spec/behavior/branding.md`](branding.md)) and recomputes `theme_palette` in the same write.

That mirror covers the hex case only. An explicit `accent_color: null` takes the branch that does neither, nulling the column while `branding.colors.accent` and `theme_palette` keep the old value — the #795 divergence, still reachable through the API and tracked in #1601. The web form never sends it.

**Audit.** A save that changes something writes one `chapter_audit_log` row with action `chapter_profile_updated`, `target_type` `chapter`, `member_visible: true`, and a `diff` of `{ field: { from, to } }` — the same shape the config PATCH uses, so `#chapter-audit` renders both identically. This closes the Chunk 06 gap where the brief's "saving any Org field writes one audit row" held for config-backed fields only (#486). The cross-cutting audit rules are canon in [`settings/README.md`](settings/README.md#audit-rules); this section only records what is specific to this route.

Three details specific to this writer:

- **The `diff` carries only changed fields, and a save that changes nothing writes no row.** The Settings form re-sends every stored value on save, so without this an officer who opened Settings and pressed Save without editing would mirror a message into the member-visible `#chapter-audit` channel — and one carrying no information, since the bridge renders an empty diff as a bare action name. The config PATCH does **not** behave the same way here; see [`settings/README.md`](settings/README.md#audit-rules) for how the two differ.
- **An accent save records `branding.colors.accent` alongside the column** when the mirror already held a value and it moved. The two can disagree on a chapter carrying the #795 divergence, where re-saving the stored column value still repaints every branded surface; recording only the column would leave that change invisible. An *absent* mirror (`branding = {}`, the column default for a chapter that skipped onboarding branding) is not a change — populating it is the system catching up, not an officer's edit. Hex comparison is case-insensitive, so re-picking the same swatch (browsers report `<input type="color">` values lowercase, seeds store uppercase) is not an edit either.
- **The row is written after the update lands**, so a failed save leaves no audit row claiming it happened, and a failed audit write surfaces as a `500` rather than being swallowed.

**Known residue (#1599):** because the update and the audit insert are separate statements, an audit failure leaves a committed change the officer was told had failed, and an identical retry then produces an empty diff and writes nothing — so on this route the change stays unaudited. The config PATCH shares the non-transactional write but recovers differently; `settings/README.md` records both. Neither writer guarantees "every mutation is audited"; closing it needs both statements in one transaction.

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
