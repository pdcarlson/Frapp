# @repo/theme

Shared Tailwind preset, CSS variables, design tokens, and chapter accent helpers for Frapp apps.

## Signet tokens (`./signet`)

`getSignetTokens()` / `signetDarkTokens` are the dark-only Signet design tokens
(transcribed from `spec/ui/design-system/foundations.md`). **`apps/mobile` is the
live consumer** as of S1 of #937: its `lib/theme.tsx` provider serves these
tokens to every typed `StyleSheet` factory. `apps/web` also reads
`signetDarkTokens` where it needs a token as a value (the settings accent
preview).

## Signet stylesheet (`./signet.css`)

`src/signet.css` is the Signet counterpart of `globals.css`: the dark-only
foundations as CSS custom properties, the ShadCN-compat pairs the shared
Tailwind preset reads, and the house-default accent slot (the
[default seed](../../spec/ui/design-system/accent-engine.md#3-default-seed) through
`deriveSignetPalette`). **Both web surfaces import it** — `apps/web` as of slice 1 of #920,
`apps/landing` as of its token cutover ([#2366](https://github.com/pdcarlson/Frapp/issues/2366)).
A surface imports exactly one stylesheet, and `src/signet.css.spec.ts` pins the
values against `getSignetCssVars()` / the accent engine plus the per-surface
import wiring in both directions.

The legacy `globals.css` is **deleted**, along with its `./globals.css` export,
in that same cutover — a cutover deletes what it replaces, and a stylesheet no
surface imports is not a migration window. `src/tailwind.config.spec.ts` was
re-pointed at `signet.css` in the same change.

The `./tokens` **export** is removed with it — nothing outside the package ever
imported it. The module itself **stays**, and is not dead:
`accent.ts` reads `frappTokens.color.brand.bronze` as the accent engine's
fallback, and both the preset and `signet.ts` read its motion scale. What went
is the stylesheet, not the token module.

## Fonts

**Figtree** is the Signet typeface. The variable font (400–700) lives at
`fonts/FigtreeVF.woff2` (OFL license alongside as `fonts/OFL-Figtree.txt`);
`apps/web` loads it with `next/font/local` from `app/layout.tsx` as
`--font-figtree`, and the shared Tailwind preset in this package sets it as
`fontFamily.sans` for both Next surfaces.
`apps/mobile` instead loads Figtree from `@expo-google-fonts/figtree` (one
static TTF per locked weight — 400/600/700 — registered under per-weight family
names, which Android requires). The `typography.family.mono` token is a CSS
variable and RN-invalid; mobile maps mono to the system stack via
`MONO_FONT_FAMILY` in `apps/mobile/lib/theme.tsx`.

`apps/landing` loads the same `fonts/FigtreeVF.woff2` the same way, from its
own `app/layout.tsx` and `app/global-error.tsx`, since its token cutover
([#2366](https://github.com/pdcarlson/Frapp/issues/2366)).

**Two static instances sit beside the variable font, and they are not a second
source.** `fonts/Figtree-Regular.ttf` and `fonts/Figtree-Bold.ttf` are the same
upstream Figtree 2.002 release, vendored by
[#2368](https://github.com/pdcarlson/Frapp/issues/2368) for exactly one consumer:
`apps/landing/app/opengraph-image.tsx`, which renders through Satori
(`next/og`). Satori cannot parse the variable `.woff2` — it throws
`Unsupported OpenType signature wOF2`, and a variable TTF fails in its own way —
so a card set in the house typeface needs static instances or it is not set in
the house typeface. Only 400 and 700 are vendored, because only those two are
used; add a weight when something uses it, not before.

**So: one typeface, three containers, each for a renderer that needs it.** The
browser gets the variable `.woff2` through `next/font/local`, React Native gets
`@expo-google-fonts/figtree`, and Satori gets these. Before vendoring a fourth
copy anywhere, check whether one of the three already fits — that duplication is
the thing this section exists to prevent.

**Geist Sans is gone.** `fonts/GeistVF.woff2` was deleted with its last
consumer in the same cutover: `apps/landing` moved to Figtree, and a replaced
asset does not outlive the thing that replaced it. Geist is explicitly rejected
as a typeface — see [spec/ui/brand-identity.md](../../spec/ui/brand-identity.md)
§3 — so do not re-vendor it.
