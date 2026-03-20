# @repo/theme

Shared Tailwind preset, CSS variables, design tokens, and chapter accent helpers for Frapp apps.

## Fonts

**Geist Sans** variable font lives at `fonts/GeistVF.woff2`. Next.js apps (`apps/landing`, `apps/web`) load it with `next/font/local` pointing at `../../../packages/theme/fonts/GeistVF.woff2` from `app/layout.tsx` so both apps share one file on disk. See [spec/ui-brand-identity.md](../../spec/ui-brand-identity.md).

`apps/docs` may continue using `next/font/google` for Geist + Geist Mono until a mono file is vendored here.
