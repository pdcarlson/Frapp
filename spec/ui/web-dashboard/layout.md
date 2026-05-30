# Web Dashboard — Design System & Layout

> Foundation tokens, dashboard typography, and the responsive strategy for the shell. Cross-app tokens (palette, type scale, radii, theming model) are canonical in [brand-identity.md](../brand-identity.md); this page records the **dashboard-specific** density and breakpoint rules.

---

## Foundation

Inherits `@repo/theme` (Tailwind preset + CSS variables). Uses ShadCN UI as the component library (installed into `apps/web` via CLI, customized to match the Frapp palette).

Semantic tokens match [`packages/theme/src/globals.css`](../../../packages/theme/src/globals.css) (source of truth). The chat-first product repaints the palette to **bone / bronze / ink** — `--primary` is deep bronze (not royal blue), `--success` is moss, and the sidebar lives on a parallel set of `--side-*` tokens that stay dark in both light and dark mode. See [brand-identity.md](../brand-identity.md) for the full token table and chapter-accent overlay model.

| Token       | Light (CSS vars)            | Dark (CSS vars)              | Usage                                  |
| ----------- | --------------------------- | --------------------------- | -------------------------------------- |
| Background  | `--background` (bone)       | `--background` (ink)        | Page bg                                |
| Card        | `--card`                    | `--card`                    | Cards, panels                          |
| Primary     | `--primary` (deep bronze)   | `--primary` (bone-bronze)   | Buttons, links, focus ring             |
| Success     | `--success` (moss)          | `--success`                 | Positive badges, success states        |
| Muted       | `--muted`                   | `--muted`                   | Secondary surfaces, subdued text       |
| Destructive | `--destructive`             | `--destructive`             | Delete, danger actions                 |
| Border      | `--border`                  | `--border`                  | Dividers, inputs                       |
| Sidebar     | `--side-*`                  | `--side-*` (same dark ink)  | Sidebar chrome — dark in both modes    |

Dashboard surfaces reach for the `.eyebrow` and `.ledger-line` utility classes from `globals.css` rather than re-implementing the micro-label + ledger-line motifs per page.

---

## Typography (Dashboard)

The dashboard uses compact, high-density typography. The values below are the rendered dashboard roles; the canonical token scale (display 24 / title 18 / section 14 / eyebrow 11 / body 14) lives in [brand-identity.md](../brand-identity.md) and `packages/theme/src/tokens.ts`.

| Element         | Size | Weight | Line Height |
| --------------- | ---- | ------ | ----------- |
| Page Title      | 24px | 700    | 1.2         |
| Section Heading | 18px | 600    | 1.3         |
| Table Header    | 13px | 600    | 1.4         |
| Table Cell      | 14px | 400    | 1.5         |
| Body            | 14px | 400    | 1.5         |
| Label           | 13px | 500    | 1.4         |
| Small/Caption   | 12px | 400    | 1.4         |

Monospace surfaces (`#chapter-audit` cards, eyebrow ledger labels) render against the system-monospace stack `--font-mono` — no webfont is bundled (see [brand-identity.md](../brand-identity.md)).

---

## Responsive Strategy

The dashboard targets **desktop-first** with a **tablet breakpoint** at 768px. Below 768px, the sidebar collapses to a slide-out drawer.

| Breakpoint  | Sidebar                                          | Content Area    |
| ----------- | ------------------------------------------------ | --------------- |
| ≥1280px     | 256px fixed                                      | Remaining width |
| 1024–1279px | 240px fixed                                      | Remaining width |
| 768–1023px  | 64px collapsed (icons only), expandable on hover | Remaining width |
| <768px      | Hidden, hamburger → slide-out overlay            | Full width      |

Content area max-width: `1200px` with `px-6` padding.

The onboarding wizard and chat surface must render without horizontal scroll down to **375px** mobile width (see [screens.md](screens.md)).
