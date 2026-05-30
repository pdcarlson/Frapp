# UI/UX Specification: Landing Page (frapp.live)

> The landing page is Frapp's storefront. It must convey trust, modernity, and clarity, and lead with the chat-first message: **chapter chat that just works, free.** Ops modules are a secondary "what's possible when you upgrade" story.

**Cross-app identity:** Frapp-wide motifs, color roles, motion, and trust rules live in **[brand-identity.md](../brand-identity.md)**. This document set specifies landing layout and content; where they conflict, **brand identity wins** for shared tokens and motifs.

## Document map

| Doc | Scope |
| --- | ----- |
| [README.md](README.md) (this file) | Overview, design system, global elements (header/footer), performance, SEO |
| [sections.md](sections.md) | Page sections in scroll order (hero, features, pricing, …) + legal pages |

---

## Design system

### Visual identity

The landing page uses the **Frapp brand palette — bone / bronze / ink** (not chapter branding). It must feel premium, confident, and clean, with no royal blue anywhere in the chrome. Surfaces use the semantic `@repo/theme` tokens; legacy `navy.*` / `royal-blue.*` utilities still compile but now resolve to ink and bronze respectively. See [brand-identity.md](../brand-identity.md) §3 for the full token table.

| Token (semantic) | Light | Dark | Usage |
| ---------------- | ----- | ---- | ----- |
| `--background` (bone) | warm bone | ink | Page background |
| `--card` | bone-card | ink-card | Card surfaces, alternating sections |
| `--primary` (deep bronze) | bronze | bone-bronze | Primary CTA buttons, links |
| `--success` (moss) | moss | moss | Success accents, feature checkmarks |
| `--foreground` / `--muted-foreground` (ink) | ink | bone | Headlines and body text |
| `--border` | border | border | Ledger lines, dividers, card borders |

### Typography

| Element | Family | Weight | Size (desktop) | Size (mobile) |
| ------- | ------ | ------ | -------------- | ------------- |
| H1 (Hero) | Geist Sans | 800 | 64px / 1.1 | 40px / 1.15 |
| H2 (Section) | Geist Sans | 700 | 40px / 1.2 | 28px / 1.25 |
| H3 (Card title) | Geist Sans | 600 | 24px / 1.3 | 20px / 1.3 |
| Body | Geist Sans | 400 | 18px / 1.6 | 16px / 1.6 |
| Body Small | Geist Sans | 400 | 16px / 1.5 | 14px / 1.5 |
| Label / Overline | Geist Sans | 500 | 14px / 1.4 | 12px / 1.4 |
| CTA Button | Geist Sans | 600 | 16px | 16px |

Apply the **micro-label + display headline** motif (uppercase tracked eyebrow over a tight-tracked display headline) per [brand-identity.md](../brand-identity.md) §2.3.

### Responsive breakpoints

| Breakpoint | Width | Layout |
| ---------- | ----- | ------ |
| Mobile | < 640px | Single column, stacked sections; hamburger nav optional (not in current home) |
| Tablet | 640–1024px | Two-column grids, compressed hero |
| Desktop | 1024–1280px | Full layout, centered max-width container |
| Wide | > 1280px | max-width 1280px centered, comfortable margins |

### Spacing scale

Use Tailwind's spacing: `4` (16px), `6` (24px), `8` (32px), `12` (48px), `16` (64px), `20` (80px), `24` (96px). Section padding: `py-20` mobile, `py-24` desktop.

### Animations

Follow [brand-identity.md](../brand-identity.md) §5 (Motion budget). Landing uses Tailwind `animate-fade-up` from `@repo/theme` where appropriate.

| Element | Animation | Trigger |
| ------- | --------- | ------- |
| Hero headline + primary CTA | **None** (static first paint) | — |
| Below-fold sections | Optional `fade-up` | Viewport entry, `motion-safe` only |
| Feature list / pricing / FAQs | Optional `fade-up` | Viewport entry, `motion-safe` only (no count-up here) |
| Stats row | Optional `fade-up` | Viewport entry; **count-up numbers only here**, and only when real data warrants it |

Do not use scale-on-hover on marketing cards, the pricing card, feature rows, or FAQs as a default; prefer **border/color** transitions (and shadow tweaks without scale) per the brand anti-patterns.

---

## Global elements

### Header / navigation bar

**Sticky** at the top of the viewport (`sticky top-0 z-40`). Use solid **`bg-background`** with **`border-b border-border`** for a flat, ledger-adjacent chrome. Optional subtle backdrop blur is allowed if contrast remains sufficient.

```text
[Logo]     [Features] [How it works] [Pricing]     [Log In]  [Start your chapter]
```

- **md and up:** show inline nav — Features (`#features`), How it works (`#how-it-works`), Pricing (`#pricing`). Documentation lives in a footer link to the repo's `docs/guides/` on GitHub.
- **Below md:** nav links hidden; logo + primary CTA remain visible. **Log In** shows from `md` upward (`hidden md:inline-flex`). A full-screen hamburger menu is optional and not part of the current home.
- Logo: Frapp lockup (`packages/brand-assets/assets/frapp-lockup.svg` + `apps/landing/components/frapp-lockup.tsx`) — see [assets.md](../assets.md).
- Nav links: `text-muted-foreground`, hover → `text-foreground`; color transitions only, no hover scale on primary chrome.
- "Log In": ghost-style link/button to the app base + `/sign-in` (the web app's Supabase Auth sign-in route; there is no `/login` route).
- Primary CTA: `bg-primary` / `text-primary-foreground` (deep bronze), hover `bg-primary/90`. Routes to `/sign-up` → onboarding wizard.

### Footer

Two sections: a links grid (4 columns desktop, 2 tablet, 1 mobile) and a bottom bar.

| Product | Resources | Legal | Company |
| ------- | --------- | ----- | ------- |
| Features | Documentation | Terms of Service | About |
| Pricing | API Reference (future) | Privacy Policy | Contact |
| | Getting Started | FERPA Notice | |

```text
© 2026 Frapp. All rights reserved.                    [Twitter] [Instagram] [LinkedIn]
```

- Social icons: 24×24, muted, hover → primary.
- Footer surface uses the dark ink token in both modes; text bone/muted.

### Dark mode

Dark styles use shared `@repo/theme` tokens (`dark:` utilities). The home page does **not** ship a header theme toggle; system preference applies unless a future control is added.

---

## Performance targets

| Metric | Target |
| ------ | ------ |
| Lighthouse Performance | ≥ 95 (not worse than the existing site) |
| LCP | < 2.0s |
| FID | < 100ms |
| CLS | < 0.1 |
| Total page weight | < 500KB (gzipped) |
| Time to Interactive | < 3.0s on 3G |

**Techniques:** Next.js SSG for all pages; `next/image` with WebP/AVIF auto-format and lazy loading (except hero); self-hosted Geist Sans (Latin subset, woff2); no client JS for content rendering; CSS animations preferred over JS; minimal third-party scripts (analytics only, async).

---

## SEO & metadata

Use the Next.js App Router `metadata` export in `apps/landing/app/layout.tsx` for `title`, `description`, `metadataBase`, `openGraph`, and `twitter` (card type `summary_large_image`).

**Do not** point `openGraph.images` / `twitter.images` at a static `/og-image.png` unless that file exists in `public/`. The canonical approach is the dynamic route **`apps/landing/app/opengraph-image.tsx`** (1200×630, ink + bronze) — see [assets.md](../assets.md). Set `openGraph.images` and `twitter.images` to the App Router OG entry (e.g. `{ url: "/opengraph-image", width: 1200, height: 630 }` resolved against `metadataBase`) so previews use the generated image at runtime.

| Field | Value |
| ----- | ----- |
| Title | Frapp — Chapter chat that just works |
| Meta description | Chapter chat that just works. Free. Add events, study hours, points, and dues when you're ready. |
| OG description | Chapter chat that just works, free — with ops modules ready when you upgrade. |

- Generate `sitemap.xml` via `next-sitemap`.
- `robots.txt` allowing all crawlers.
- Structured data: `SoftwareApplication` JSON-LD where appropriate.
