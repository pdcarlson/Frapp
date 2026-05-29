# Chapter Config Endpoints (Chunk 02)

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

## POST /chapters/:id/theme-palette

Recomputes the derived palette from `branding.colors` via `derivePalette()`, persists to `chapters.theme_palette`, and returns the full token map. Triggered automatically by PATCH when `branding.colors` changes.
