# @repo/brand-assets

Canonical **Signet** product marks (not chapter logos).

The shipping mark is **locked emblem B** — gold `#DDB844` on charcoal `#1A1A1A`, neck break, treated as an abstract crest ([`spec/ui/brand-identity.md`](../../spec/ui/brand-identity.md) §2). It never takes a chapter accent.

## The source of truth is a vector

`assets/signet-emblem-B.svg` is the **vector master**. Every raster in this package and under `apps/mobile/assets/images/` is rendered from it by `npm run rasterize:brand-assets`; nothing here is hand-committed.

Before [#2153](https://github.com/pdcarlson/Frapp/issues/2153) the source of truth was a 1280×720 JPEG-derived "Design lock" PNG, letterboxed around a ~454px tile that the script cropped and upscaled 2.26×. It contained `#DDB844` in **zero** pixels — it measured `#DDA220` on `#151515` across 24,069 distinct colours — and `check:brand-assets` compared sha256 hashes only, so nothing could see the gap. The gate now reads pixels; the predicates live in [`scripts/lib/brand-pixels.mjs`](../../scripts/lib/brand-pixels.mjs) and are unit-tested by `npm run test:ci-scripts`.

## Naming

Canonical assets follow one scheme, asserted by `scripts/ci/__tests__/brand-pixels.test.mjs`:

```
signet-emblem-B[-glyph|-rounded][-<size>].<svg|png|ico>
```

| Part      | Meaning                                                                 |
| --------- | ----------------------------------------------------------------------- |
| `-glyph`  | crest alone on a **transparent** field — no charcoal tile                |
| `-rounded`| crest on a charcoal tile with the app-icon corner radius                 |
| `-<size>` | raster edge length in px. Vectors carry no size, and neither does the `.ico` — it is a container of three sizes, so naming one would be a lie. |
| *(none)*  | the master: crest on a square, full-bleed charcoal field                 |

**One exception:** `frapp-lockup.svg` keeps its name. [`spec/ui/assets.md`](../../spec/ui/assets.md) §1 freezes `frapp-*` filenames (`"frapp-* filenames, @repo/brand-assets, and frapp.live domains stay as-is in code"`), so renaming it is a separate decision that has to change that rule first.

Names written into `apps/` are **not** ours: `app/icon.png`, `app/apple-icon.png` and `app/favicon.ico` are Next App Router file conventions, `public/brand/signet-emblem-B.png` is the path the components request, and the Expo names are fixed by `apps/mobile/app.json`. `sync-brand-assets.mjs` renames on copy.

## Contents

| Asset                          | Size / format  | Use                                                       |
| ------------------------------ | -------------- | --------------------------------------------------------- |
| `signet-emblem-B.svg`          | SVG 1024²      | **Vector master.** Everything below renders from it.       |
| `signet-emblem-B-glyph.svg`    | SVG 1024²      | Crest alone, transparent — for non-charcoal surfaces       |
| `signet-emblem-B-rounded.svg`  | SVG 1024²      | Crest on a rounded charcoal tile                           |
| `frapp-lockup.svg`             | SVG 3360×1024  | Rounded tile + "Signet" wordmark (`currentColor`)          |
| `signet-emblem-B-1024.png`     | PNG 1024² RGB  | Square tile; source for the in-app tile and Expo `icon.png` |
| `signet-emblem-B-glyph-1024.png` | PNG 1024² RGBA | Crest alone, transparent                                 |
| `signet-emblem-B-180.png`      | PNG 180² RGB   | Apple touch icon                                           |
| `signet-emblem-B-48.png`       | PNG 48² RGB    | Favicon                                                    |
| `signet-emblem-B-32.png`       | PNG 32² RGB    | Favicon; source for Next `app/icon.png`                    |
| `signet-emblem-B-16.png`       | PNG 16² RGB    | Favicon                                                    |
| `signet-emblem-B.ico`          | ICO 16/32/48   | Next `app/favicon.ico`; a container of the three PNGs above |

All four SVGs are written in the same coordinate frame — origin `0 0`, 1024 units tall — so the same path data is reused **verbatim** and cannot drift between them; the test asserts byte-equal path strings. Only the viewBox *width* differs: the lockup is `0 0 3360 1024` because it carries the wordmark beside the tile, and each file's intrinsic `width`/`height` must keep its viewBox aspect or every raster renders distorted. That drift is what #2153 was: a "superseded" SVG and the shipping raster drew different artwork, in the same commit, from birth.

### Which one to reach for

- On the **charcoal field**, or where a self-contained tile is wanted → `signet-emblem-B-1024.png` (or the matching size).
- On **any other surface** → the `-glyph` pair. The glyph is rendered against transparency rather than keyed out of the tile, so it carries no dark fringe onto light backgrounds.
- **Scalable** contexts (email, print, SVG-capable UI) → the `.svg` of the same variant.

## Consumers

- **Next.js:** `npm run rasterize:brand-assets` then `npm run sync:brand-assets` from the repo root updates `app/icon.png`, `app/apple-icon.png`, `public/brand/signet-emblem-B.png`, and `web`'s `app/favicon.ico`. Both apps also run sync on `prebuild`. What gets copied where is `SYNCED` in [`scripts/lib/brand-pixels.mjs`](../../scripts/lib/brand-pixels.mjs) — the sync script and the CI gate both walk that one list, so a destination cannot be copied without also being gated.
- **Landing header:** `apps/landing/components/frapp-lockup.tsx` (tile + Signet word).
- **Web auth:** `apps/web/components/auth/signet-mark.tsx`.
- **Expo:** rasters under `apps/mobile/assets/images/` — see [`spec/ui/assets.md`](../../spec/ui/assets.md) §7.

## Regenerating

1. Edit `assets/signet-emblem-B.svg` (and `signet-emblem-B-glyph.svg`, keeping the path identical).
2. `npm run rasterize:brand-assets`
3. `npm run sync:brand-assets`
4. `npm run check:brand-assets`

Steps 2 and 4 both refuse a mark that is not drawn in the locked pair, and refuse an empty or solid Android monochrome layer.

## Monorepo tasks

This package has **no** `package.json` `scripts`. Turbo does not run `build`, `lint`, or `check-types` here. Validation runs via root `npm run check:brand-assets` (CI) and `npm run test:ci-scripts`.

## Imports

```ts
import markUrl from "@repo/brand-assets/signet-emblem-B.svg";
import glyphUrl from "@repo/brand-assets/signet-emblem-B-glyph.svg";
```

Requires the consuming bundler to resolve the export. Prefer a PNG where a fixed raster size is needed.
