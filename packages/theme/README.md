# @repo/theme

Shared Tailwind preset, CSS variables, design tokens, and chapter accent helpers for Frapp apps.

## Signet tokens (`./signet`)

`getSignetTokens()` / `signetDarkTokens` are the dark-only Signet design tokens
(transcribed from `spec/ui/design-system/foundations.md`). **`apps/mobile` is the
live consumer** as of S1 of #937: its `lib/theme.tsx` provider serves these
tokens to every typed `StyleSheet` factory. The legacy `./tokens` entrypoint
(`getFrappTokens`) now serves web/landing only, until their own reskin (#920).

## Fonts

**Geist Sans** variable font lives at `fonts/GeistVF.woff2`. Next.js apps (`apps/landing`, `apps/web`) load it with `next/font/local` pointing at `../../../packages/theme/fonts/GeistVF.woff2` from `app/layout.tsx` so both apps share one file on disk. See [spec/ui/brand-identity.md](../../spec/ui/brand-identity.md) (Geist remains the legacy web/landing font until their Signet reskin; Signet's family is Figtree).

**Figtree** is not vendored here: `apps/mobile` loads it from
`@expo-google-fonts/figtree` (one static TTF per locked weight — 400/600/700 —
registered under per-weight family names, which Android requires). The
`typography.family.mono` token is a CSS variable and RN-invalid; mobile maps
mono to the system stack via `MONO_FONT_FAMILY` in `apps/mobile/lib/theme.tsx`.
