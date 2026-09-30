# Signet UI assets — logos, icons, Open Graph

> Normative companion to [brand-identity.md](brand-identity.md). Defines the **product-owned** raster/SVG assets, where they live, how apps consume them without drift, and how the locked emblem regenerates.

---

## 1. Status: locked emblem B

The committed assets ship **locked emblem B** — gold `#DDB844` on charcoal `#1A1A1A`, neck break, treated as an abstract crest. `frapp-*` filenames, `@repo/brand-assets`, and `frapp.live` domains stay as-is in code. Naming follows [`brand-identity.md` § 1](brand-identity.md#1-identity).

- The animal mascot (a seal, the animal) remains **not commissioned** and MUST NOT ship until the USPTO search clears; [brand-identity.md](brand-identity.md) owns that ban.
- Teams MUST NOT restyle the locked emblem piecemeal. Edit `packages/brand-assets/assets/signet-emblem-B.svg` — the vector master — then rasterize and sync (§8).
- **`#DDB844` / `#1A1A1A` are both the specification and what the pixels measure**, settled in [#2153](https://github.com/pdcarlson/Frapp/issues/2153). They did not agree before: the committed rasters descended from a JPEG-derived letterbox and measured `#DDA220` on `#151515`, with `#DDB844` in zero pixels of any file. The mark was re-exported at the spec'd values — the spec did **not** move to the measured ones, because those were compression artifacts rather than brand values. History is in [`web-greenfield/tokens.md`](web-greenfield/tokens.md) L-08.
- Do not sample a raster to "correct" the hexes above. If the mark must change, change `signet-emblem-B.svg` and re-run the pipeline in §8; `check:brand-assets` reads pixels and fails anything not drawn in the locked pair.
- This package produces the in-repo Expo rasters and Next favicons, and `npm run rasterize:brand-assets` also renders the Google Play icon and feature graphic from the same master into `apps/mobile/store/graphics/`, which the owner uploads in Play Console (§4). The iOS Light / Dark / Tinted variants are §7's.

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

Canonical assets are named **`signet-emblem-B[-glyph|-rounded][-<size>].<svg|png|ico>`**. `-glyph` is the crest alone on transparent, `-rounded` is the crest on a tile with the app-icon corner radius, no suffix is the square full-bleed master, and `-<size>` is a raster's edge length in px. The `.ico` carries no `-<size>`: it is a container of three, so naming one would be a lie. `frapp-lockup.svg` is the one exception, because §1 freezes `frapp-*` filenames. `scripts/ci/__tests__/brand-pixels.test.mjs` asserts the scheme.

| File                             | Format          | Use                                                                        |
| -------------------------------- | --------------- | -------------------------------------------------------------------------- |
| `signet-emblem-B.svg`            | SVG 1024²       | **Source of truth.** Every raster below renders from it.                    |
| `signet-emblem-B-glyph.svg`      | SVG 1024²       | Crest alone on transparent — for surfaces that are not the charcoal field   |
| `signet-emblem-B-rounded.svg`    | SVG 1024²       | Crest on a rounded charcoal tile                                            |
| `frapp-lockup.svg`               | SVG 2880×1024   | Crest alone (no tile) + Frapp wordmark; the word uses `currentColor`        |
| `signet-emblem-B-1024.png`       | PNG 1024² RGB   | Square tile — Expo `icon.png` and the in-app tiles                          |
| `signet-emblem-B-glyph-1024.png` | PNG 1024² RGBA  | Crest alone on transparent, no dark fringe on light surfaces                |
| `signet-emblem-B-180.png`        | PNG 180² RGB    | Apple touch icon, synced into both Next apps                                |
| `signet-emblem-B-48.png` / `-32` / `-16` | PNG RGB | Favicon sizes; `-32` is the Next App Router favicon source (`app/icon.png`) |
| `signet-emblem-B.ico`            | ICO 16/32/48 RGBA | `apps/web/app/favicon.ico` — those three rasters with an opaque alpha channel. **RGBA is not optional:** Turbopack builds this file and its ICO decoder refuses a non-RGBA payload, failing the web production build |

All four SVGs are written in the same coordinate frame — origin `0 0`, 1024 units tall — so the same path data is reused **verbatim** and cannot drift between them. Only the viewBox *width* differs (`frapp-lockup.svg` is 2880 wide because it carries the wordmark beside the crest), and each file's intrinsic `width`/`height` must keep the viewBox's aspect or every raster renders distorted. `check:brand-assets` asserts all of it. That drift is exactly what #2153 was: a "superseded" SVG and the shipping raster drew different artwork, authored in one commit, disagreeing from birth.

Requirements:

- App icon MUST stay legible at 16px favicon scale.
- Lockup MUST stay readable at ~120px width; the word uses `fill="currentColor"` when inlined so theme text colors apply. The crest stays `#DDB844`.
- **Page headers draw the crest alone, with no tile** (owner, 2026-09-28, [#2580](https://github.com/pdcarlson/Frapp/issues/2580)). On `--background` (`#131211`) a charcoal or `surface-1` tile reads as a second, slightly different dark square, so the lockup and the landing header put the gold crest straight on the page. The `#1A1A1A` tile (`signet-emblem-B-1024.png`, `-rounded`) stays wherever the mark is a square icon on its own: app icon, favicon, Apple touch icon, and the Stripe and Google OAuth icons.
- Consumers MUST NOT hand-edit synced copies (`apps/*/app/icon.png`) or any raster in this package — every one of them is generated. Edit the SVG master and re-run rasterize + sync.
- Use the `-glyph` pair wherever the mark sits on a surface that is not the charcoal field: it is rendered against transparency rather than keyed out of the tile, so it carries no dark fringe.

---

## 4. Synced locations, sync, and CI

| What                                  | Path                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Vector master                         | `packages/brand-assets/assets/signet-emblem-B.svg` (plus `signet-emblem-B-glyph.svg`) |
| Source rasters                        | `packages/brand-assets/assets/signet-emblem-B-1024.png`, `-180.png`, `-48.png`, `-32.png`, `-16.png`, `signet-emblem-B-glyph-1024.png`, and `signet-emblem-B.ico` (all generated) |
| Synced copies | Every destination listed in `SYNCED` (`scripts/lib/brand-pixels.mjs`), the one list the sync copies along and the gate checks: the tab and Apple touch icons in both Next apps, `apps/web/app/favicon.ico` (the 16/32/48 container; `apps/landing` serves `icon.png` only), both apps' `public/brand/signet-emblem-B.png` tile, and `apps/landing/app/opengraph-emblem.png` |
| Landing lockup (React)                | `apps/landing/components/frapp-lockup.tsx` — Frapp word plus the crest from [`signet-crest.tsx`](../../apps/landing/components/signet-crest.tsx), inlined as one path since #2366 and no longer a raster. The crest (`#DDB844`) sits on the page background with no tile since ADR-25 step 5. |
| OG image                              | `apps/landing/app/opengraph-image.tsx`                                                                 |

| Command | Effect |
| ------- | ------ |
| `npm run rasterize:brand-assets` (root; runs `scripts/rasterize-brand-assets.mjs`) | Renders every canonical raster and every Expo raster from the SVG master, and the two Google Play listing graphics into `apps/mobile/store/graphics/`: `play-icon-512.png`, the master tile at 512² as a 32-bit PNG, and `play-feature-graphic-1024x500.png`, the landing header's lockup over the listing's short description in the vendored Figtree, with no alpha channel (composition and reasons: `scripts/lib/store-graphics.mjs`). Refuses an SVG that paints anything but the locked pair, and refuses an empty or solid Android monochrome layer. |
| `npm run sync:brand-assets` (root; runs `scripts/sync-brand-assets.mjs`) | Copies the 32², 180², and 1024² rasters and the `.ico` into the Next apps under the names Next and the components expect. It walks `SYNCED` in `scripts/lib/brand-pixels.mjs` — the same list the gate asserts parity along, so a destination cannot be copied without also being gated |
| `npm run check:brand-assets` (root; runs `scripts/check-brand-assets.mjs`, then the audit tests in `scripts/lib/__tests__/`) | The script's header lists every property it asserts; among them: **Parity:** synced copies must be byte-identical to their canonical source. **Pixels:** every committed raster must be drawn in the locked pair, and every glyph layer must be non-empty — hash parity alone is blind to both, which is how #2153 shipped green. **Containment:** every `favicon.ico` payload must be RGBA (Turbopack fails the build otherwise), must sit under a directory entry that does not misdeclare it, and its RGB plane must be byte-identical to the canonical raster of that size; nothing else can see inside a container, which is how `apps/web/app/favicon.ico` shipped Next's scaffold icon. **iOS icon:** `apps/mobile/assets/frapp.icon` is exactly what the rasterizer writes, and its crest is the glyph vector's path in the locked gold. **Store graphics:** the Play icon is 512², RGBA and fully opaque, in the locked pair, clear of the corners Play's 30% radius mask removes, and still a render of the vector; the feature graphic is 1024×500 with no alpha channel, paints nothing but the field within 96px of an edge, and matches a fresh render up to rounding, so a stale crest, changed copy or changed colour fails. Runs in CI (`.github/workflows/ci.yml`) |

The parity check covers every `SYNCED` destination. The React lockup component is aligned manually via the checklist in §8.

---

## 5. Next.js behavior

- **`app/icon.png`:** App Router [file convention](https://nextjs.org/docs/app/api-reference/file-conventions/metadata/app-icons); emitted per deployment (immutable URL with build id). Synced from the canonical 32² raster, which renders from the SVG master (§3).
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

Android and the web take **raster** icons: `apps/mobile/app.json` references PNGs under `apps/mobile/assets/images/` (`icon.png`, `adaptive-icon.png`, `adaptive-icon-monochrome.png`, `splash-icon.png`, `favicon.png`). iOS takes the Icon Composer bundle described below instead, and none of these PNGs reaches it.

Shapes: `icon.png` 1024² opaque RGB, the full-bleed tile, which Expo uses wherever no platform-specific icon is set; `adaptive-icon.png`, `adaptive-icon-monochrome.png` and `splash-icon.png` 1024² **glyph-only on transparent** — the crest alone, inset 17% so the 66% launcher safe zone clips nothing (the monochrome layer is white, for Android themed icons). These composited an opaque charcoal tile until [#2153](https://github.com/pdcarlson/Frapp/issues/2153); that square showed as a hard edge on the splash background and made the layer uncheckable, since its alpha measured the same whether the crest was there or not; `favicon.png` 96² for `expo start --web`. `android.adaptiveIcon.backgroundColor` is `#1A1A1A`, the mark's field.

**iOS draws its icon from an Icon Composer bundle, not from these PNGs** (owner, 2026-09-30). `expo.ios.icon` names `apps/mobile/assets/frapp.icon`: an `icon.json` and one layer, `Assets/crest.svg`, the glyph vector's path in the locked gold on the brand frame. `npm run rasterize:brand-assets` writes both; `scripts/lib/ios-icon.mjs` holds the document and why each field is set. The fill is the mark's field in the default and dark appearances. The crest is a glass layer with Liquid Glass's specular edge and a light neutral shadow, which the owner accepted as the platform's treatment of the mark; translucency is off, so the gold is not tinted by the field behind it. Clear and tinted have no overrides: iOS renders the crest white or grey on its own background there, so neither locked colour survives in those two modes. Xcode compiles the bundle (Xcode 26 or later; EAS's SDK 57 image is 26.6) and derives the pre-iOS 26 icon from it. Nothing here can compile it, so the first EAS build is its first real test, and the app store icon comes from the same bundle. The top-level `icon.png` stays for Android and the web.

After the SVG master changes:

1. Run `npm run rasterize:brand-assets` then `npm run sync:brand-assets`.
2. `android.adaptiveIcon.backgroundColor` MUST stay the mark field (`#1A1A1A`) — the launcher paints it behind the transparent crest, so it *is* the mark's field on Android. The `expo-splash-screen` plugin's `backgroundColor` is deliberately **not** the mark field: the splash image is transparent, so it sits on the app's own `--background` and the splash-to-app transition has no seam.
3. The iOS icon ships in the binary, not through App Store Connect, which has no icon field ([Add an app icon](https://developer.apple.com/help/app-store-connect/manage-app-information/add-an-app-icon)), so a changed icon reaches people only with a new build. `expo.ios.icon` must stay a plain string naming the `.icon` bundle: `@expo/prebuild-config` 57 copies it into the native project and sets `ASSETCATALOG_COMPILER_APPICON_NAME` to its name. It warns about a `.icon` anywhere else: as the top-level `icon` it still uses it, and inside a `light`/`dark`/`tinted` object it treats the directory as an image, which prebuild cannot rasterize. `check:brand-assets` fails if the bundle stops being exactly what the rasterizer writes.

---

## 8. Update procedure

1. Edit `packages/brand-assets/assets/signet-emblem-B.svg`. Apply the same path edit to `signet-emblem-B-glyph.svg`, `signet-emblem-B-rounded.svg`, and `frapp-lockup.svg` — they share the master's coordinate frame, so the `d` string copies verbatim, and a test fails if they diverge. Do not change any `fill`: `check:brand-assets` reads every shipped SVG, including the two that are never rasterized.
2. Run `npm run rasterize:brand-assets` then `npm run sync:brand-assets` from the repo root. Do **not** hand-commit a raster; all of them are generated. A regenerated Play graphic reaches the listing only when the owner uploads it again.
3. Align `apps/landing/components/signet-crest.tsx` and `apps/web/components/auth/signet-mark.tsx` if the in-app tile path changed. The landing's crest geometry and its `#DDB844` fill moved into that module in [#2368](https://github.com/pdcarlson/Frapp/issues/2368) and are read from there by the header lockup, the closing crest and the social card, so it is the only landing file to edit. Nothing checks this literal against the vector — `check:brand-assets` compares SVGs and rasters only — so a missed alignment is silent.
4. Run `npm run check:brand-assets` and `npm run test:ci-scripts` (root) before PR.

A Design hand-off that arrives as a PNG or JPEG is **not** committable as-is: it has to be traced to vectors first. A lossy raster as source of truth is the whole of #2153.

---

## 9. Anti-patterns

- Hand-editing `apps/*/app/icon.png` — CI check fails on drift.
- Duplicated "slightly different" icons per app.
- Chapter logo on the marketing homepage header, or the product mark painted with a chapter accent ([brand-identity.md](brand-identity.md)).
- `og:image` pointing at a missing file (404 hurts crawlers and previews).
- Restyling the locked emblem toward a new mark without changing the SVG master first (§1).
- Committing a raster by hand, or treating a JPEG-derived upload as a source of truth (#2153).
