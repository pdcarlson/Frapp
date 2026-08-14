# Chapter Branding

Behavior and boundaries for per-chapter branding. Visual design tokens (palette, typography, radii) are owned by the UI spec; this file covers what branding *means* and what the API enforces. Editing of branding happens in the settings Theme tab — see [`settings/customization.md`](settings/customization.md).

## Logo

- Chapters can upload a logo image (PNG, JPG, WebP; max 2 MB).
- The logo is displayed in: the app header/sidebar, the member directory, exported PDF reports, and the onboarding tutorial welcome screen. On mobile it appears in the Home and Chat headers.
- Logo is stored in Supabase Storage under `chapters/{chapter_id}/branding/logo.{ext}`.
- The `branding` bucket is **private**, so `logo_path` is not addressable by a client on its own. `GET /v1/chapters/current` returns a signed **`logo_url`** alongside it; that is the only supported way for a client to render the logo. When signing fails the field is `null` — the logo is decoration, and an unreachable asset must not fail the chapter read.
- If no logo is uploaded, the chapter name is displayed as text.

## Accent Color

> This section describes the **currently shipping** single-accent model. Signet replaces it with a
> 12-step generated scale — see [`../ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md).
> Both are live during the cutover: Signet surfaces consume the generated scale; `apps/web` and
> `apps/landing` keep the model below until their reskin. Update this section when that lands.

- Chapters can set a custom accent color (hex string, e.g. `#8B0000` for crimson). It is stored on the `chapters` table in two places, and **`branding.colors.accent` is authoritative** (#795). The `accent_color` column is a mirror the API maintains on every write path — onboarding, the config PATCH, and the direct column update from Settings, which also writes the value back into `branding.colors.accent` so the two cannot drift. Before this, the onboarding wizard wrote only the jsonb, so the column kept its default and every surface reading it showed Royal Blue for a chapter that had chosen otherwise.
- The accent color is applied to: primary buttons, links, active tab indicators, the chat self-bubble, mention pills, and highlights throughout the app — for that chapter's members only. On mobile that means the active tab tint, primary buttons, and in-chapter highlights.
- Two different "defaults" are in play, and they are not interchangeable:
  - **Stored default** — the `chapters.accent_color` column defaults to Frapp's Royal Blue `#2563EB`, so that is what a chapter holds until an accent is chosen. Chapters onboarded before #795 kept it regardless of what they picked; `20260814120000_backfill_chapter_accent_color_from_branding.sql` repairs those rows.
  - **Render fallback** — what a client paints when the stored accent is absent, malformed, or illegible on the surface at hand. This is the `@repo/theme` brand accent token, and it is *mode-dependent*: bronze in light, bone-bronze in dark. `@repo/theme` owns those values; this file does not restate them.
- **WCAG enforcement:** the API validates the `accent_color` column on save and rejects colors failing 4.5:1 against the light-mode background — bone `#FAF7F2`, the surface the app actually renders on, corrected from a navy-era slate `#F8FAFC` that no surface had used since the bone/bronze rebrand. Only against light mode, so a stored accent is not automatically safe everywhere. Crimson (`#8B0000`) is the worked example: 10.0:1 on white, 1.7:1 on the native dark card.
- **`branding.colors.accent` is deliberately NOT contrast-gated.** It is the Signet accent engine's *seed*, and the raw seed never paints UI ([`../ui/design-system/accent-engine.md`](../ui/design-system/accent-engine.md) §1) — the engine derives a scale from it and guarantees the contrast of the roles that do paint. Gating it would also reject almost every real chapter: 49 of the 50 chapters in `supabase/seed/chapter_directory.csv` have an accent below 4.5:1 on the light surface, `#C9A56F` alone accounting for 45 of them at 2.16:1, because fraternity colors are so often light golds, silvers, and whites. The field is format-validated only. This supersedes #600, which assumed the two stores were the same kind of thing.
- Because of that, **clients re-validate per surface** rather than trusting the stored value. `resolveChapterAccentColor` (`@repo/theme/accent`) takes the background and the mode's own fallback accent, and substitutes the fallback when the chapter's accent fails. A failing color surfaces an inline warning in the editor and falls back to safe tokens rather than hard-failing the edit.
- Note this bites the stored default too: `#2563EB` is 5.2:1 on white but 3.2:1 on the dark card, so in dark mode an uncustomized chapter renders the fallback token rather than Royal Blue. That is the intended outcome — legibility wins over exactness.

## Brand Boundaries

- Chapter branding applies **only within the chapter context** — when a user is viewing that chapter's data.
- The **Frapp brand** (navigation shell, splash screen, landing site, docs site) is **not** affected by chapter branding.
- On mobile the boundary is the route group: the `(tabs)` group is chapter context and carries chapter branding; the `(auth)` group sits outside it and stays Frapp-branded, since no chapter is resolved before sign-in.
- Switching the active chapter re-resolves branding in place. Chapter identity comes from the `active_chapter_id` token claim (see [`multi-tenancy.md`](multi-tenancy.md)), so no restart or cache reset is involved.
