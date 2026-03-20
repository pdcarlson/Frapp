# @repo/brand-assets

Canonical **Frapp** marketing marks (not chapter logos).

## Contents

| Asset | Path |
| ----- | ---- |
| App / tab icon | `assets/app-icon.svg` |
| Lockup (mark + word) | `assets/frapp-lockup.svg` |

## Consumers

- **Next.js:** Run `node scripts/sync-brand-assets.mjs` from the monorepo root so `app/icon.svg` is updated in `landing`, `web`, and `docs`.
- **Landing header:** Uses `apps/landing/components/frapp-lockup.tsx` (inline SVG with `currentColor` for the word); keep in sync when changing `frapp-lockup.svg`.
- **Email / PDF:** Embed `frapp-lockup.svg` or export PNG from the same source.
- **Expo:** Regenerate raster icons under `apps/mobile/assets/images/` (see `docs/internal/BRAND_ASSETS.md`).

## Imports

```ts
import iconUrl from "@repo/brand-assets/app-icon.svg";
```

Requires the consuming bundler to resolve the export (Next resolves `*.svg` as static assets when configured).
