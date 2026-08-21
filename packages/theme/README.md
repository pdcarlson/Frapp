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
Tailwind preset reads, and the house-default accent slot (`#F2B72E` through
`deriveSignetPalette`). **`apps/web` imports it** as of slice 1 of #920;
`apps/landing` keeps importing the legacy `globals.css` until its own reskin. A
surface imports exactly one of the two — `src/signet.css.spec.ts` pins the
values against `getSignetCssVars()` / the accent engine and the per-surface
import wiring in both directions. The legacy `./tokens` entrypoint
(`getFrappTokens`) now backs the landing surface only.

## Fonts

**Figtree** is the Signet typeface. The variable font (400–700) lives at
`fonts/FigtreeVF.woff2` (OFL license alongside as `fonts/OFL-Figtree.txt`);
`apps/web` loads it with `next/font/local` from `app/layout.tsx` as
`--font-figtree`, and its Tailwind config sets it as `fontFamily.sans`.
`apps/mobile` instead loads Figtree from `@expo-google-fonts/figtree` (one
static TTF per locked weight — 400/600/700 — registered under per-weight family
names, which Android requires). The `typography.family.mono` token is a CSS
variable and RN-invalid; mobile maps mono to the system stack via
`MONO_FONT_FAMILY` in `apps/mobile/lib/theme.tsx`.

**Geist Sans** lives at `fonts/GeistVF.woff2` and is now the legacy font for
`apps/landing` only, loaded with `next/font/local` from its `app/layout.tsx`
until the landing reskin. See
[spec/ui/brand-identity.md](../../spec/ui/brand-identity.md).
