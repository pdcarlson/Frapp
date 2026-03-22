# Brand assets — operations

> Canonical specs: [spec/ui-assets.md](../../spec/ui-assets.md) and [spec/ui-brand-identity.md](../../spec/ui-brand-identity.md).

## Locations

| What                                  | Path                                                                                                   |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Source SVGs                           | `packages/brand-assets/assets/app-icon.svg`, `frapp-lockup.svg`                                        |
| Synced tab icons                      | `apps/landing/app/icon.svg`, `apps/web/app/icon.svg`                         |
| Landing lockup (React)                | `apps/landing/components/frapp-lockup.tsx` — inline SVG; keep visually aligned with `frapp-lockup.svg`. Fills use theme CSS vars (`--brand-lockup-bg` in `@repo/theme` `globals.css`, `hsl(var(--primary))` for the mark). |
| Landing public copy (optional embeds) | `apps/landing/public/frapp-lockup.svg` (synced for “right-click save” / docs)                          |
| OG image                              | `apps/landing/app/opengraph-image.tsx`                                                                 |

## Sync command

```bash
node scripts/sync-brand-assets.mjs
```

Run after any edit to `packages/brand-assets/assets/*.svg`. The script copies `app-icon.svg` into the three Next apps and verifies byte equality.

## CI / local check

```bash
npm run check:brand-assets
```

Fails if synced icons differ from the canonical file.

## Email templates

- Prefer embedding **`frapp-lockup.svg`** (from `node_modules/@repo/brand-assets/assets/` after install, or copy at build time).
- Use absolute `#0F172A` for word fill in standalone SVG if `currentColor` is not available in the client.
- Frapp marks are **not** interchangeable with chapter logos from Storage.

## Open Graph cache

Social platforms cache preview images aggressively. If you replace the generated OG route, use Vercel’s redeploy or the platform’s debugger to refresh.

## Expo / mobile rasters

`apps/mobile/app.json` references PNGs under `assets/images/`. SVG cannot be used as the store icon. After changing the master mark:

1. Export PNGs at required sizes from `app-icon.svg` (design tool or `npx @aspect-ratio/...` as appropriate).
2. Replace `icon.png`, `adaptive-icon.png`, `splash-icon.png`, `favicon.png` as needed.
3. Keep background colors consistent with product (see `app.json` `splash.backgroundColor`).
