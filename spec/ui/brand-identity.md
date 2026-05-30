# Frapp brand identity — cross-app UI

> **Single source of truth** for what “looks like Frapp” on frapp.live, app.frapp.live, and (eventually) mobile. Product and landing specs inherit this; implementation inherits [`@repo/theme`](../../packages/theme). The canonical visual reference (palette, prototypes, screenshots) lives at [`docs/internal/design-reference/`](../../docs/internal/design-reference/).

---

## 1. Positioning and voice

- **Line:** “The operating system for Greek life.” (see [../product/](../product/README.md).)
- **Voice:** Direct, operational, chapter-native. Prefer concrete nouns (attendance, dues, roster) over abstract “synergy.” Avoid startup clichés (“supercharge,” “10×,” “all-in-one” without proof).
- **Trust:** Differentiation comes from **clarity and honesty**, not invented metrics. Stats, logos, and testimonials on the marketing site must be **true** or **clearly marked as illustrative** until verified.
- **Aesthetic:** Bone / bronze / ink — newspaper-warm neutrals, deep bronze accent, ink sidebar. No royal blue anywhere in chrome (chapter accents may overlay later; see [`../redesign-context.md`](../redesign-context.md) *Theming model* and §3a below).

---

## 2. Signature motifs (repeat everywhere)

These are intentional repeats—not one-off landing tricks—so the product and marketing feel like one system.

### 2.1 Ledger line

A **full-width hairline** (`border-t border-border` or 1px rule) separates major blocks. Section titles sit **on** the line or immediately above it with consistent vertical rhythm. Evokes ledgers, rosters, and run-of-show—appropriate for chapter operations.

### 2.2 Flat surfaces, border-defined depth

**No** soft gradient hero washes or glassmorphism as the default hero treatment. Primary surfaces use **solid** `background` / `card` tokens and **visible borders** for hierarchy. Shadows are **minimal** (e.g. `shadow-sm` only where needed for elevation, not decoration).

### 2.3 Micro-label + display headline

**Micro-label:** uppercase, `text-xs`, `font-semibold`, wide letter-spacing (`tracking-[0.2em]`–`0.24em]`), `text-muted-foreground` or emerald for a single accent line. **Headline:** `text-navy` / inverse in dark mode, tight tracking on the headline itself (`tracking-tight`), weight 700–800.

Dashboard surfaces should reach for the `.eyebrow` and `.ledger-line` utility classes from [`packages/theme/src/globals.css`](../../packages/theme/src/globals.css) instead of re-implementing these per page.

---

## 3. Color roles

The chat-first redesign moves the chrome palette from royal-blue + navy to **bone / bronze / ink**. The semantic token names (`primary`, `success`, `foreground`, `border`, etc.) are stable; the *values* changed in [`packages/theme/src/globals.css`](../../packages/theme/src/globals.css) and [`packages/theme/src/tokens.ts`](../../packages/theme/src/tokens.ts). Existing Tailwind utility classes that reference `navy.*` or `royal-blue.*` keep compiling — they now resolve to ink and bronze, respectively. New work should prefer the semantic tokens.

| Role                         | Token / usage                                                              | Where                                                                                                         |
| ---------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| **Frapp primary (actions)**  | `primary` (deep bronze in `@repo/theme`)                                   | Primary buttons, links, focus rings, key CTAs                                                                 |
| **Frapp success / positive** | `success` / emerald utilities (moss values under the hood)                 | Badges, check states, “active” positive chips—not primary buttons                                             |
| **Frapp neutral text**       | `foreground`, `muted-foreground`, `navy` utilities (ink values)            | Body, headings, chrome                                                                                        |
| **Frapp sidebar (chrome)**   | `--side-bg`, `--side-fg`, `--side-accent` CSS variables                    | Always-dark sidebar — never overridden by light/dark mode                                                     |
| **Chapter accent**           | Validated hex per chapter ([`accent.ts`](../../packages/theme/src/accent.ts)) | In-product chapter branding only (avatars, role chips, chapter settings)—**not** the global marketing palette |

Marketing (`frapp.live`) uses **Frapp** tokens only unless showing an **in-app screenshot** where chapter accent appears in context.

---

## 3a. Theming model (chapter accent overlay)

Each chapter supplies **two colors only** — `branding.colors = { dark, accent }`. `derivePalette()` expands them into the per-chapter CSS variables applied in-product:

| Variable | Derivation |
| -------- | ---------- |
| `--side-bg` | chapter `dark` tinted toward ink (mix 70% chapter-dark + 30% neutral ink for legibility) |
| `--side-accent` | `accent` |
| `--brand-band` | `accent` at low saturation, for header strips |
| `--mention-bg` / `--mention-fg` | derived from `accent` with contrast guarantees |
| `--chat-self-bubble` | `accent` at 8% over bone |
| `--reaction-active` | `accent` |
| `--ring` | `accent` |

**WCAG fallback.** Each derived token is validated against **both** bone (light) and ink (dark) backgrounds. If either fails AA 4.5:1, that token specifically falls back to bronze — never the whole palette (validation utility: [`packages/theme/src/accent.ts`](../../packages/theme/src/accent.ts)).

**Lifecycle.** The palette is rebuilt **server-side** on color change and cached in `chapters.theme_palette`. The client reads it through `useChapterTheme()` and writes the CSS variables onto `:root`, re-running on every chapter switch — no full reload. The always-dark sidebar never inverts with light/dark mode; only the content surfaces swap.

---

## 4. Typography

- **Family:** Geist Sans as the single UI family (loaded once from [`packages/theme/fonts/GeistVF.woff2`](../../packages/theme/fonts/GeistVF.woff2) via `next/font/local` in each Next app; variable `--font-geist-sans`).
- **Roles:** Apply the **micro-label + display headline** motif on marketing; the dashboard uses **compact** sizes per [web-dashboard/layout.md](web-dashboard/layout.md).
- **Scale:** Display 24 / title 18 / section 14 / eyebrow 11 / body 14 (px). See [`packages/theme/src/tokens.ts`](../../packages/theme/src/tokens.ts) `type.*`.
- **Radii:** xs 3 / sm 5 / md 7 / lg 9 / xl 12 (px). Matches the `--radius-*` CSS variables and `frappTokens.radius.*`.

### Monospace

`--font-mono` is a deliberate **system-monospace stack** (`ui-monospace, SFMono-Regular, …, monospace`), **not** a bundled webfont. Ledger-line motifs, eyebrow labels, and `#chapter-audit` cards render against the system stack. Because the stack needs no loading, the "monospace family must be loaded" engineering principle is satisfied for free. Do **not** bundle Geist Mono (or any mono webfont) unless brand explicitly revisits this; if you do reference a custom monospace family in CSS, load it via `next/font` first.

---

## 5. Motion budget

Aligned with [packages/theme/src/tokens.ts](../../packages/theme/src/tokens.ts) (`motion.duration`, `motion.easing`).

| Zone                   | Rule                                                                                                                                               |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| **First paint (hero)** | No entrance animation on LCP-critical text or primary CTA. Prefer static layout.                                                                   |
| **Below the fold**     | Optional `fade-up` / stagger once (`motion-safe`, respect `prefers-reduced-motion`).                                                               |
| **Hover**              | Color and border transitions only; **avoid** scale transforms on primary chrome (buttons, nav) unless explicitly specified for a single component. |
| **Duration**           | Prefer `standard` (220ms) for UI chrome; `context` (300ms) max for section entrances.                                                              |

---

## 6. Anti-patterns (“vibe-coded SaaS”)

Avoid as **default** patterns:

- Full-width **gradient washes** behind the hero as the only visual idea.
- **Six-up icon cards** as the sole product story (icons are supporting, not the hero narrative).
- **Unverified** large numbers and fake-sounding quotes presented as established truth.
- **Excessive** hover lift / shadow on every card.
- **Emerald** (success) as the global primary button color—reserved for success semantics; primary CTAs use the `primary` token (deep bronze in `@repo/theme`), never the legacy `royal-blue.*` utilities.

---

## 7. Spec map

| Document                                            | Scope                            |
| --------------------------------------------------- | -------------------------------- |
| [brand-identity.md](brand-identity.md) (this file)  | Cross-app identity               |
| [landing/](landing/README.md)                       | frapp.live layout and sections   |
| [web-dashboard/](web-dashboard/README.md)           | app.frapp.live shell and screens |
| [assets.md](assets.md)                              | Logos, favicons, OG, asset sync  |
| [../product/](../product/README.md)                 | Surfaces and features            |

---

## 8. Implementation map

| Layer                                | Location                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| CSS variables + Tailwind preset      | `packages/theme/src/globals.css`, `packages/theme/src/tailwind.config.ts`                                           |
| TS tokens (motion, radius, feedback) | `packages/theme/src/tokens.ts`                                                                                      |
| Chapter accent validation            | `packages/theme/src/accent.ts`                                                                                      |
| Frapp mark + lockup (canonical)      | `packages/brand-assets/assets/` — see [assets.md](assets.md)                                                  |
| Synced app icons (`app/icon.svg`)    | `apps/landing`, `apps/web` — copied from brand-assets by `scripts/sync-brand-assets.mjs`               |
| Open Graph preview image             | `apps/landing/app/opengraph-image.tsx` — social cards when links are shared; do not reference missing static URLs   |
| Chapter logo (tenant)                | Supabase Storage `chapters/{id}/branding/logo.*` — **never** replaces Frapp marketing assets                        |
| Next apps                            | `apps/landing`, `apps/web` — both use `@repo/theme` preset                                              |
| Email / external templates           | Embed or host files from `@repo/brand-assets` per [docs/internal/BRAND_ASSETS.md](../../docs/internal/BRAND_ASSETS.md) |
