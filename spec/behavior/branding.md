# Chapter Branding

Behavior and boundaries for per-chapter branding. Visual design tokens (palette, typography, radii) are owned by the UI spec; this file covers what branding *means* and what the API enforces. Editing of branding happens in the settings Theme tab — see [`settings/customization.md`](settings/customization.md).

## Logo

- Chapters can upload a logo image (PNG, JPG, WebP; max 2 MB).
- The logo is displayed in: the app header/sidebar, the member directory, exported PDF reports, and the onboarding tutorial welcome screen.
- Logo is stored in Supabase Storage under `chapters/{chapter_id}/branding/logo.{ext}`.
- If no logo is uploaded, the chapter name is displayed as text.

## Accent Color

- Chapters can set a custom accent color (hex string, e.g. `#8B0000` for crimson). It is stored on the `chapters` table.
- The accent color is applied to: primary buttons, links, active tab indicators, the chat self-bubble, mention pills, and highlights throughout the app — for that chapter's members only.
- Default accent color (if none set): Frapp's Royal Blue `#2563EB`.
- **WCAG enforcement:** the accent color must meet WCAG AA contrast (4.5:1) against the background. The API validates contrast on save and rejects colors that fail. In the editor, a failing color surfaces an inline warning and the save falls back to safe tokens rather than hard-failing the edit.

## Brand Boundaries

- Chapter branding applies **only within the chapter context** — when a user is viewing that chapter's data.
- The **Frapp brand** (navigation shell, splash screen, landing site, docs site) is **not** affected by chapter branding.
