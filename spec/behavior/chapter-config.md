# Chapter Config Endpoints

Chapter configuration is the merge of **archetype defaults** with **per-chapter overrides**. Reads return the merged shape; every write records an audit row and mirrors a `system_audit` message into the chapter's `#chapter-audit` channel.

## GET /chapters/:id/config

Returns the merged chapter configuration: archetype defaults overlaid with per-chapter overrides.

**Auth:** Bearer JWT, with chapter context resolved per [`multi-tenancy.md`](multi-tenancy.md), and membership required. Permission: `chapter-config:view`.

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

The customizable sub-resources surfaced through chapter config (full schema in [`spec/architecture/README.md`](../architecture/README.md)) — the last three are reachable through this PATCH, the first two are not:

- **`chapter_custom_fields`** — **not on this PATCH.** `PatchChapterConfigDto` carries no `custom_fields` property; a CRUD controller (`custom-fields`) serves it, and [`settings/customization.md`](settings/customization.md) is canon for its routes. Per-chapter member fields. `(key, label, type, required, visibility, sensitive, options, sort)`. `visibility ∈ {self, chapter, exec, president}`.
- **`chapter_custom_roles`** — **not on this PATCH** either, for the same reason and with its own `custom-roles` controller. `(key, label, rank, capabilities[], core)`. `core=false` roles can be deleted.
- **`chapter_workflows`** — `(key, enabled, threshold, params)`. Each enabled workflow can configure its numeric threshold.
- **`branding`** — Greek letters, designation, school short, founded year, and the accent seed (`colors.accent`). A second colour, `colors.dark`, existed until the #920 slice-9 cutover; it fed only the deleted legacy token map, and a row written before then keeps an inert value that no reader looks at.
- **`enabled_modules`** — the per-module on/off map (see [`spec/product/modules.md`](../product/modules.md)).

## PATCH /chapters/current — core chapter profile

Settings → Organization → "Chapter profile" does **not** go through the config PATCH above. The four core `chapters` columns — `name`, `university`, `donation_url`, `accent_color` — are written by `PATCH /v1/chapters/current`, guarded by `chapter-config:view` **and** `chapter-config:manage` (`CHAPTER_PROFILE_PERMISSIONS` in `@repo/validation`, which the Settings page's profile and accent saves also read; the logo routes below use the same pair). Until #2575 the route admitted `roles:manage` **or** `billing:manage` while the page gated on `chapter-config:manage`, so the default Treasurer could save through the API but not the page. Why `view` too: [`rbac.md`](rbac.md)'s `chapter-config:manage` row.

`accent_color` sits here rather than under `branding` despite reading as branding: the accent editor posts to this route, and a save carrying a hex mirrors the value into `branding.colors.accent` (authoritative per [`spec/behavior/branding.md`](branding.md)) and recomputes `theme_palette` in the same write.

That mirror covers the hex case only. An explicit `accent_color: null` takes the branch that does neither, nulling the column while `branding.colors.accent` and `theme_palette` keep the old value — the #795 divergence, still reachable through the API and tracked in #1601. The web form never sends it.

**Audit.** A save that changes something writes one `chapter_audit_log` row with action `chapter_profile_updated`, `target_type` `chapter`, `member_visible: true`, and a `diff` of `{ field: { from, to } }` — the same shape the config PATCH uses, so `#chapter-audit` renders both identically. This closes the Chunk 06 gap where the brief's "saving any Org field writes one audit row" held for config-backed fields only (#486). The cross-cutting audit rules are canon in [`settings/README.md`](settings/README.md#audit-rules); this section only records what is specific to this route.

Three details specific to this writer:

- **The `diff` carries only changed fields, and a save that changes nothing writes no row.** The Settings form re-sends every stored value on save, so without this an officer who opened Settings and pressed Save without editing would mirror a message into the member-visible `#chapter-audit` channel — and one carrying no information, since the bridge renders an empty diff as a bare action name. The config PATCH does **not** behave the same way here; see [`settings/README.md`](settings/README.md#audit-rules) for how the two differ.
- **An accent save records `branding.colors.accent` alongside the column** when the mirror already held a value and it moved. The two can disagree on a chapter carrying the #795 divergence, where re-saving the stored column value still repaints every branded surface; recording only the column would leave that change invisible. An *absent* mirror (`branding = {}`, the column default for a chapter that skipped onboarding branding) is not a change — populating it is the system catching up, not an officer's edit. Hex comparison is case-insensitive, so re-picking the same swatch (browsers report `<input type="color">` values lowercase, seeds store uppercase) is not an edit either.
- **The row is written after the update lands**, so a failed save leaves no audit row claiming it happened, and a failed audit write surfaces as a `500` rather than being swallowed.

**Known residue (#1599):** because the update and the audit insert are separate statements, an audit failure leaves a committed change the officer was told had failed, and an identical retry then produces an empty diff and writes nothing — so on this route the change stays unaudited. The config PATCH shares the non-transactional write but recovers differently; `settings/README.md` records both. Neither writer guarantees "every mutation is audited"; closing it needs both statements in one transaction.

### The logo routes

`POST /v1/chapters/current/logo-url` mints the signed upload, `POST /v1/chapters/current/logo` confirms it into `logo_path`, and `DELETE /v1/chapters/current/logo` removes it. Storage rules are in [`branding.md`](branding.md) § Logo. All three take the same `CHAPTER_PROFILE_PERMISSIONS` as the profile PATCH, and the two writes return the same member-safe projection (`toChapterMemberView`, #930), never the raw row.

**Audit (#2575).** Every confirm writes a member-visible `chapter_audit_log` row with action `chapter_logo_updated`, and a delete that removed a logo writes `chapter_logo_removed`. Both use `target_type` `chapter` and a `diff` of `{ logo_path: { from, to } }`. A delete when no logo was set writes nothing. A confirm writes its row even when `from` equals `to`, unlike the profile PATCH, because the server can't tell whether the object at that path changed. Confirm doesn't check that an upload happened, so a stored path can name a missing object, and an upload to that free key followed by a confirm of the same path changes the logo without moving the column. A redundant row costs less than a missed change. (Replacing a logo with another of the same extension is refused at the mint today, because the key already exists: #2592.) The rows are written after the update lands. The two writers recover differently from a failed insert (#1599). A retried confirm writes a row whose `from` equals `to`, so the change is recorded but its original `from` is lost. A retried removal finds no logo and writes nothing, so the removal stays unaudited, as on the profile PATCH.

## POST /chapters/:id/theme-palette

Recomputes the derived palette from `branding.colors.accent` via `buildChapterPalette`, persists it to `chapters.theme_palette` together with the engine version that wrote it (`theme_palette_engine_version`, which is not returned), and returns the build. The write is compare-and-set on the accent it read: if an accent save lands in between, this write is skipped and the newer palette stands, and the response still carries the build for the accent as read — the token map under `palette`, plus `invalidSeed` and `failedContrastChecks`. The config PATCH runs the same recompute after any write of `branding`, with or without `colors` and changed or not, because that write stores the whole merged branding as read, accent included (why: [`accent-engine.md`](../ui/design-system/accent-engine.md) §6 Persistence). The derivation and role map are canon in [`spec/ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md); where the palette lives and who writes it is in [`spec/architecture/README.md`](../architecture/README.md).

## Dues configuration

Dues live in a singleton `chapter_dues_config` row per chapter (PK `chapter_id`), edited through chapter config:

- `cadence` — the stored values are `monthly` / `per_semester` / `per_quarter`; [`settings/customization.md`](settings/customization.md) owns them.
- `active_amount_cents`, `new_member_amount_cents`, `alumni_amount_cents` — per-tier amounts (non-negative integer cents).
- `installments_allowed` (+ installment count when allowed), `late_fee_cents`, `grace_days`, `scholarship_pool_cents`.

All cents fields are validated as non-negative integers (no `NaN`, no negatives — see [`spec/engineering.md`](../engineering.md)). A write to dues config produces a `chapter_audit_log` row and a `#chapter-audit` message like every other config change.

## GET /chapter-directory/search

Directory search backs the onboarding autofill. `GET /chapter-directory/search?q=...&university=...` returns the top matches from `chapter_directory` (Greek org letters/name + university, with default colors and identity fields) for the wizard to pre-fill chapter identity. Backed by indexes on `(university_short, org_letters)` and full-text on the combined name. Directory rows are public chapter identities, not personal data.
