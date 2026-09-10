# Signet UI assets — logos, icons, Open Graph

> Normative companion to [brand-identity.md](brand-identity.md). Defines the **product-owned** raster/SVG assets, where they live, how apps consume them without drift, and how the locked emblem regenerates.

---

## 1. Status: locked emblem B

The committed assets ship **locked emblem B** — gold `#DDB844` on charcoal `#1A1A1A`, neck break, treated as an abstract crest. `frapp-*` filenames, `@repo/brand-assets`, and `frapp.live` domains stay as-is in code. Prose says Signet; code cites real current names.

- The animal mascot (a seal, the animal) remains **not commissioned** and MUST NOT ship until the USPTO search clears; [brand-identity.md](brand-identity.md) owns that ban.
- Teams MUST NOT restyle the locked emblem piecemeal — edit `packages/brand-assets/assets/app-icon.svg`, then rasterize and sync.
- iOS **Light / Dark / Tinted** store variants and a Play Console feature graphic are still an Ops / EAS step; this package produces the in-repo Expo rasters and Next favicons.

---

## 2. Roles: product vs chapter

| Asset kind                                | Owner   | Purpose                                                                                                              |
| ----------------------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------- |
| **Product app icon** (favicon / tab icon) | Product | Same mark on `frapp.live` and `app.frapp.live`                                                                        |
| **Product lockup** (icon + wordmark)      | Product | Landing header, marketing email headers, future templates                                                             |
| **Open Graph image**                      | Product | Preview card when a marketing URL is shared (Slack, iMessage, etc.)                                                   |
| **Chapter logo**                          | Tenant  | In-app surfaces, PDFs, onboarding — from Storage (`logo_path`); **does not** replace product marks on marketing or docs |

The product mark NEVER takes the chapter accent, and chapter accent applies inside chapter context only — see [brand-identity.md](brand-identity.md).

---

## 3. Canonical package

All canonical files live in **`@repo/brand-assets`** (`packages/brand-assets/assets/`):

| File                         | Format            | Use                                                                    |
| ---------------------------- | ----------------- | ---------------------------------------------------------------------- |
| `app-icon.svg`               | SVG 64×64 viewBox | Favicon / app icon; **source** for synced `app/icon.svg` and Expo rasters |
| `app-icon-glyph.svg`         | SVG 64×64 viewBox | Glyph-only (no tile) for adaptive / splash rasters                     |
| `frapp-lockup.svg`           | SVG               | Email embeds, download links, parity reference for the inline React lockup |
| `signet-emblem-B-locked.png` | PNG 1024²        | Master raster of the locked crest                                      |
| `apple-icon.png`             | PNG 180²         | Apple touch icon, synced into both Next apps                           |

Requirements:

- App icon MUST stay legible at 16px favicon scale.
- Lockup MUST stay readable at ~120px width; the word uses `fill="currentColor"` when inlined so theme text colors apply. The tile and crest stay `#1A1A1A` / `#DDB844`.
- Consumers MUST NOT hand-edit synced copies (`apps/*/app/icon.svg`) — edit the canonical file and re-run rasterize + sync.

---

## 4. Synced locations, sync, and CI

| What                                  | Path                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Source SVGs                           | `packages/brand-assets/assets/app-icon.svg`, `app-icon-glyph.svg`, `frapp-lockup.svg`                 |
| Synced tab icons                      | `apps/landing/app/icon.svg`, `apps/web/app/icon.svg`                                                   |
| Synced Apple touch icons              | `apps/landing/app/apple-icon.png`, `apps/web/app/apple-icon.png`                                       |
| Landing lockup (React)                | `apps/landing/components/frapp-lockup.tsx` — inline SVG; keep visually aligned with `frapp-lockup.svg`. Tile/crest are hardcoded `#1A1A1A` / `#DDB844`. |
| Landing public copy (optional embeds) | `apps/landing/public/frapp-lockup.svg` (synced for "right-click save" / docs)                          |
| OG image                              | `apps/landing/app/opengraph-image.tsx`                                                                 |

| Command | Effect |
| ------- | ------ |
| `npm run rasterize:brand-assets` (root; runs `scripts/rasterize-brand-assets.mjs`) | Writes the 1024 master PNG, Expo rasters, and `apple-icon.png` from the SVGs |
| `npm run sync:brand-assets` (root; runs `scripts/sync-brand-assets.mjs`) | Copies `app-icon.svg` and `apple-icon.png` into both Next apps and `frapp-lockup.svg` into `apps/landing/public/` |
| `npm run check:brand-assets` (root; runs `scripts/check-brand-assets.mjs`) | Fails if either synced `app/icon.svg` or `apple-icon.png` is not byte-identical to the canonical file. Runs in CI (`.github/workflows/ci.yml`) |

The check covers tab icons and Apple touch icons. The React lockup component and the public lockup copy are aligned manually via the checklist in §8.

---

## 5. Next.js behavior

- **`app/icon.svg`:** App Router [file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons); emitted per deployment (immutable URL with build id).
- **`app/apple-icon.png`:** Apple touch icon, synced from the canonical 180² raster.
- **`opengraph-image.tsx`:** [Open Graph image](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) route generating the 1200×630 card; avoids shipping a broken static `/og-image.png`.
- Landing `metadata` in `apps/landing/app/layout.tsx` MUST reference the App Router OG route (`openGraph.images` / `twitter.images` resolve against `metadataBase`), not a static `/og-image.png`, unless that file actually exists in `public/`.
- **OG cache:** social platforms cache preview images aggressively. After replacing the OG route, redeploy and use the platform's debugger (e.g. Slack, X card validator) to refresh.

---

## 6. Email templates

No transactional email templates exist in-repo yet; this binds the first ones built.

- Prefer embedding **`frapp-lockup.svg`** (from `node_modules/@repo/brand-assets/assets/` after install, or copied at build time).
- When inlined in HTML that supports CSS, the word uses `currentColor`. A fixed word fill for clients that ignore `currentColor` is `#1A1A1A` on light and `#DDB844` is the crest, not the word.
- Product marks are **not** interchangeable with chapter logos from Storage.

---

## 7. Mobile (Expo) rasters

Expo requires **raster** launcher icons: `apps/mobile/app.json` references PNGs under `apps/mobile/assets/images/` (`icon.png`, `adaptive-icon.png`, `adaptive-icon-monochrome.png`, `splash-icon.png`, `favicon.png`); SVG cannot be the store icon.

Shapes: `icon.png` 1024² opaque RGB (Apple rejects alpha); `adaptive-icon.png` and `adaptive-icon-monochrome.png` 1024² glyph-only on transparent, with the glyph well inside the 66% safe zone so launcher masks never clip it (the monochrome layer is white, for Android themed icons); `splash-icon.png` glyph-only on transparent over the `expo-splash-screen` plugin's `backgroundColor`; `favicon.png` 96² for `expo start --web`. `android.adaptiveIcon.backgroundColor` is `#1A1A1A`, the mark's own field.

After the master SVG changes:

1. Run `npm run rasterize:brand-assets` then `npm run sync:brand-assets`.
2. Keep the `expo-splash-screen` plugin's `backgroundColor` and `android.adaptiveIcon.backgroundColor` in `app.json` consistent with the mark field.
3. iOS Light / Dark / Tinted store variants remain an Ops / EAS upload.

---

## 8. Update procedure

1. Edit SVGs only under `packages/brand-assets/assets/`.
2. Run `npm run rasterize:brand-assets` then `npm run sync:brand-assets` from the repo root.
3. Align `apps/landing/components/frapp-lockup.tsx` with `frapp-lockup.svg` if the lockup geometry changed.
4. Run `npm run check:brand-assets` (root) before PR.

---

## 9. Anti-patterns

- Hand-editing `apps/*/app/icon.svg` — CI check fails on drift.
- Duplicated "slightly different" icons per app.
- Chapter logo on the marketing homepage header, or the product mark painted with a chapter accent ([brand-identity.md](brand-identity.md)).
- `og:image` pointing at a missing file (404 hurts crawlers and previews).
- Restyling the locked emblem toward a new mark without replacing the canonical SVG first (§1).
