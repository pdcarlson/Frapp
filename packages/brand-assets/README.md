# @repo/brand-assets

Canonical **Signet** marketing marks (not chapter logos). Filenames stay `frapp-*` where they already were.

The shipping mark is Design's locked emblem B PNG. Do not regenerate it from SVG.

## Contents

| Asset                | Path                              |
| -------------------- | --------------------------------- |
| Master raster        | `assets/signet-emblem-B-locked.png` |
| Square tile          | `assets/signet-emblem-B-tile.png`  |
| Next favicon         | `assets/icon.png`                 |
| Favicon 16 / 32 / 48 | `assets/favicon-16.png` (etc.)    |
| Apple touch icon     | `assets/apple-icon.png`           |
| App / tab icon (old) | `assets/app-icon.svg` (not shipping) |
| Lockup (word only)   | `assets/frapp-lockup.svg`         |

## Consumers

- **Next.js:** Run `npm run rasterize:brand-assets` then `npm run sync:brand-assets` from the monorepo root so `app/icon.png`, `apple-icon.png`, and `public/brand/signet-emblem-B.png` update in `landing` and `web`.
- **Landing header:** Uses `apps/landing/components/frapp-lockup.tsx` (Design tile + Signet word).
- **Expo:** Rasters under `apps/mobile/assets/images/` come from `npm run rasterize:brand-assets` (see `spec/ui/assets.md`).

## Monorepo tasks

This package has **no** `package.json` `scripts`. Turbo does not run `build`, `lint`, or `check-types` here. Validation still runs via root `npm run check:brand-assets`.

## Imports

```ts
import iconUrl from "@repo/brand-assets/app-icon.svg";
```

Requires the consuming bundler to resolve the export. Prefer the PNG tile for anything user-visible.
