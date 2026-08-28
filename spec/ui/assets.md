# Signet UI assets — logos, icons, Open Graph

> Normative companion to [brand-identity.md](brand-identity.md). Defines the **product-owned** raster/SVG assets, where they live, how apps consume them without drift, and what is pending the Signet asset regeneration.

---

## 1. Status: Signet regeneration is PENDING

The committed assets described below still ship the **legacy Frapp look** — the inline landing lockup follows the bone/bronze theme vars, and the static SVGs and the OG route carry older hardcoded fills. This is expected, not drift:

- The Signet logo's final form is **TBD pending trademark search**; [brand-identity.md](brand-identity.md) owns the placeholder "S" mark spec.
- Raster + OG + icon regeneration is **blocked on the final logo** and lands as one Signet asset pass once the mark clears; any tracking for it lives in GitHub Issues, not in this spec.
- Until then, `frapp-*` filenames, `@repo/brand-assets`, and `frapp.live` domains stay as-is in code. Prose says Signet; code cites real current names.
- Teams MUST NOT restyle the legacy assets toward Signet piecemeal — the whole set regenerates together from the final mark.

The regenerated Signet app icon MUST ship with iOS **Light / Dark / Tinted** variants and an Android **monochrome** adaptive-icon layer; [brand-identity.md](brand-identity.md) owns those requirements.

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

| File               | Format            | Use                                                                    |
| ------------------ | ----------------- | ---------------------------------------------------------------------- |
| `app-icon.svg`     | SVG 64×64 viewBox | Favicon / app icon; **source** for synced `app/icon.svg` and Expo rasters |
| `frapp-lockup.svg` | SVG               | Email embeds, download links, parity reference for the inline React lockup |

Both files currently draw the legacy "F" mark; they are replaced in place (same filenames) by the Signet mark in the Signet asset pass (§1).

Requirements:

- App icon MUST stay legible at 16px favicon scale.
- Lockup MUST stay readable at ~120px width; the word uses `fill="currentColor"` when inlined so theme text colors apply.
- Consumers MUST NOT hand-edit synced copies (`apps/*/app/icon.svg`) — edit the canonical file and re-run sync.

---

## 4. Synced locations, sync, and CI

| What                                  | Path                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Source SVGs                           | `packages/brand-assets/assets/app-icon.svg`, `frapp-lockup.svg`                                        |
| Synced tab icons                      | `apps/landing/app/icon.svg`, `apps/web/app/icon.svg`                                                   |
| Landing lockup (React)                | `apps/landing/components/frapp-lockup.tsx` — inline SVG; keep visually aligned with `frapp-lockup.svg`. Fills use theme CSS vars (`--brand-lockup-bg` in `@repo/theme` `globals.css`, `hsl(var(--primary))` for the mark). |
| Landing public copy (optional embeds) | `apps/landing/public/frapp-lockup.svg` (synced for "right-click save" / docs)                          |
| OG image                              | `apps/landing/app/opengraph-image.tsx`                                                                 |

| Command | Effect |
| ------- | ------ |
| `npm run sync:brand-assets` (root; runs `scripts/sync-brand-assets.mjs`) | Copies `app-icon.svg` into both Next apps' `app/icon.svg` and `frapp-lockup.svg` into `apps/landing/public/` |
| `npm run check:brand-assets` (root; runs `scripts/check-brand-assets.mjs`) | Fails if either synced `app/icon.svg` is not byte-identical to the canonical file. Runs in CI (`.github/workflows/ci.yml`) |

The check covers tab icons only. The React lockup component and the public lockup copy are aligned manually via the checklist in §8.

---

## 5. Next.js behavior

- **`app/icon.svg`:** App Router [file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons); emitted per deployment (immutable URL with build id).
- **`opengraph-image.tsx`:** [Open Graph image](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/opengraph-image) route generating the 1200×630 card; avoids shipping a broken static `/og-image.png`.
- Landing `metadata` in `apps/landing/app/layout.tsx` MUST reference the App Router OG route (`openGraph.images` / `twitter.images` resolve against `metadataBase`), not a static `/og-image.png`, unless that file actually exists in `public/`.
- **OG cache:** social platforms cache preview images aggressively. After replacing the OG route, redeploy and use the platform's debugger (e.g. Slack, X card validator) to refresh.

The OG route's current styling and copy are legacy Frapp; the Signet card is produced in the Signet asset pass (§1), not by editing the current route's colors.

---

## 6. Email templates

No transactional email templates exist in-repo yet; this binds the first ones built.

- Prefer embedding **`frapp-lockup.svg`** (from `node_modules/@repo/brand-assets/assets/` after install, or copied at build time).
- When inlined in HTML that supports CSS, the word uses `currentColor`. A fixed word fill for clients that ignore `currentColor` is chosen with the Signet asset pass (§1) — do not carry legacy hex fills forward.
- Product marks are **not** interchangeable with chapter logos from Storage.

---

## 7. Mobile (Expo) rasters

Expo requires **raster** launcher icons: `apps/mobile/app.json` references PNGs under `apps/mobile/assets/images/` (`icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png`); SVG cannot be the store icon.

After the master mark changes:

1. Export PNGs at the required sizes from `app-icon.svg` (design tool or CLI rasterizer).
2. Replace `icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png` as needed.
3. Keep `app.json` `splash.backgroundColor` and `android.adaptiveIcon.backgroundColor` consistent with product surfaces. Current values (`#ffffff`) are legacy; Signet values are set in the Signet asset pass, which also adds the iOS Light/Dark/Tinted variants and Android monochrome layer (§1).

---

## 8. Update procedure

1. Edit SVGs only under `packages/brand-assets/assets/`.
2. Run `npm run sync:brand-assets` from the repo root.
3. Align `apps/landing/components/frapp-lockup.tsx` with `frapp-lockup.svg` if the lockup geometry changed.
4. Regenerate Expo rasters if the mark changed (§7).
5. Run `npm run check:brand-assets` (root) before PR.

---

## 9. Anti-patterns

- Hand-editing `apps/*/app/icon.svg` — CI check fails on drift.
- Duplicated "slightly different" icons per app.
- Chapter logo on the marketing homepage header, or the product mark painted with a chapter accent ([brand-identity.md](brand-identity.md)).
- `og:image` pointing at a missing file (404 hurts crawlers and previews).
- Restyling individual legacy assets toward Signet ahead of the final logo (§1).
