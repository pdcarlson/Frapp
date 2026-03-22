# UI/UX Specification: Landing Page (frapp.live)

> The landing page is Frapp's storefront. It must convey trust, modernity, and clarity. Every pixel should say: "This is the tool your chapter needs."

**Cross-app identity:** Frapp-wide motifs, color roles, motion, and trust rules live in **[spec/ui-brand-identity.md](ui-brand-identity.md)**. This document specifies landing layout and content; where they conflict, **brand identity wins** for shared tokens and motifs.

---

## 1. Design System

### Visual Identity: "Modern Ivy"

The landing page uses the Frapp brand palette — not chapter branding. It must feel premium, confident, and clean.

| Token          | Light Mode | Dark Mode | Usage                               |
| -------------- | ---------- | --------- | ----------------------------------- |
| `--navy`       | `#0F172A`  | `#F8FAFC` | Headlines, hero text                |
| `--royal-blue` | `#2563EB`  | `#60A5FA` | Primary CTA buttons, links          |
| `--emerald`    | `#10B981`  | `#34D399` | Success accents, feature highlights |
| `--slate-bg`   | `#F8FAFC`  | `#0F172A` | Page background                     |
| `--slate-50`   | `#F8FAFC`  | `#1E293B` | Section alternating bg              |
| `--slate-100`  | `#F1F5F9`  | `#1E293B` | Card backgrounds                    |
| `--slate-400`  | `#94A3B8`  | `#64748B` | Body text (secondary)               |
| `--slate-600`  | `#475569`  | `#94A3B8` | Body text (primary)                 |
| `--white`      | `#FFFFFF`  | `#0F172A` | Card surfaces                       |

### Typography

| Element         | Font       | Weight | Size (Desktop) | Size (Mobile) |
| --------------- | ---------- | ------ | -------------- | ------------- |
| H1 (Hero)       | Geist Sans | 800    | 64px / 1.1     | 40px / 1.15   |
| H2 (Section)    | Geist Sans | 700    | 40px / 1.2     | 28px / 1.25   |
| H3 (Card title) | Geist Sans | 600    | 24px / 1.3     | 20px / 1.3    |
| Body            | Geist Sans | 400    | 18px / 1.6     | 16px / 1.6    |
| Body Small      | Geist Sans | 400    | 16px / 1.5     | 14px / 1.5    |
| Label/Overline  | Geist Sans | 500    | 14px / 1.4     | 12px / 1.4    |
| CTA Button      | Geist Sans | 600    | 16px           | 16px          |

### Responsive Breakpoints

| Breakpoint | Width       | Layout                                          |
| ---------- | ----------- | ----------------------------------------------- |
| Mobile     | < 640px     | Single column, stacked sections, hamburger nav  |
| Tablet     | 640–1024px  | Two-column grids, compressed hero               |
| Desktop    | 1024–1280px | Full layout, centered max-width container       |
| Wide       | > 1280px    | max-width: 1280px centered, comfortable margins |

### Spacing Scale

Use Tailwind's spacing: `4` (16px), `6` (24px), `8` (32px), `12` (48px), `16` (64px), `20` (80px), `24` (96px). Section padding: `py-20` mobile, `py-24` desktop.

### Animations

Follow **[spec/ui-brand-identity.md](ui-brand-identity.md) §5 (Motion budget).** Landing implementation uses Tailwind `animate-fade-up` from `@repo/theme` where appropriate.

| Element                       | Animation                     | Trigger                                                   |
| ----------------------------- | ----------------------------- | --------------------------------------------------------- |
| Hero headline + primary CTA   | **None** (static first paint) | —                                                         |
| Below-fold sections           | Optional `fade-up`            | Viewport entry, `motion-safe` only                        |
| Feature list / pricing / FAQs | Optional `fade-up`            | Viewport entry                                            |
| Stats row                     | Optional `fade-up`            | Viewport entry (no count-up unless real data warrants it) |

Do not use scale-on-hover on marketing cards as a default; prefer border/color transitions per brand anti-patterns.

---

## 2. Global Elements

### Header / Navigation Bar

**Sticky** at the top of the viewport. Use solid **`bg-background`** and **`border-b border-border`** for a flat, ledger-adjacent chrome (aligned with [ui-brand-identity.md](ui-brand-identity.md) §2.2). Optional subtle backdrop blur is allowed if contrast remains sufficient.

**Layout (reference: `apps/landing/app/page.tsx`):**

```text
[Logo]     [Features] [How it works] [Pricing]     [Log In]  [Get Started]
```

- **md and up:** Show inline nav: Features (`#features`), How it works (`#how-it-works`), Pricing (`#pricing`). Documentation lives in the footer link to the repo’s `docs/guides/` on GitHub (not duplicated in the header).
- **Below md:** Nav links are hidden; logo + primary **Get Started** CTA remain visible. **Log In** is shown from `md` upward (`hidden md:inline-flex` pattern). A full-screen hamburger menu is optional and not part of the current home implementation.

- Logo: Frapp lockup (`packages/brand-assets/assets/frapp-lockup.svg` + `apps/landing/components/frapp-lockup.tsx`) — see [ui-assets.md](ui-assets.md)
- Nav links: `text-muted-foreground`, hover to `text-foreground` (or equivalent), color transitions only — **no** hover scale on primary chrome per [ui-brand-identity.md](ui-brand-identity.md) §5
- "Log In": Ghost-style link/button to signup base + `/login`
- "Get Started": `bg-primary` / `text-primary-foreground`, hover `bg-primary/90` (semantic primary = royal blue in light mode)

**Scroll behavior:**

- Sticky header with `z-40` in the reference layout (`sticky top-0 z-40`)
- Flat chrome: `border-b border-border bg-background`

### Footer

Two sections: links grid + bottom bar.

**Links grid (4 columns on desktop, 2 on tablet, 1 on mobile):**

| Product  | Resources              | Legal            | Company |
| -------- | ---------------------- | ---------------- | ------- |
| Features | Documentation          | Terms of Service | About   |
| Pricing  | API Reference (future) | Privacy Policy   | Contact |
|          | Getting Started        | FERPA Notice     |         |

**Bottom bar:**

```text
© 2026 Frapp. All rights reserved.                    [Twitter] [Instagram] [LinkedIn]
```

- Social icons: 24x24, slate-400, hover: royal-blue
- Footer bg: `slate-900` (light mode), `slate-950` (dark mode), text white/slate-300

### Dark mode

Dark styles use shared `@repo/theme` tokens (`dark:` utilities). The home page does **not** ship a header theme toggle; system preference applies unless a future control is added (e.g. sun/moon persisted in `localStorage`).

---

## 3. Page Sections (Scroll Order)

### Section 1: Hero

**The most important section.** Must communicate the value proposition in under 5 seconds.

**Desktop layout:**

```text
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   [Overline: "THE OPERATING SYSTEM FOR GREEK LIFE"]     │
│                                                         │
│   Replace Discord, OmegaFi,                             │
│   and Life360 with one app.                             │
│                                                         │
│   [Body: One platform for chat, events, study hours,    │
│   points, backwork, and billing. Built for the way      │
│   chapters actually run.]                               │
│                                                         │
│   [Get Started Free →]  [Watch Demo ▶]                  │
│                                                         │
│   ┌─────────────────────────────────────┐               │
│   │                                     │               │
│   │      [App Mockup / Screenshot]      │               │
│   │                                     │               │
│   └─────────────────────────────────────┘               │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Content:**

- Overline: Uppercase, letter-spacing 2px, emerald-500, font-weight 500, 14px
- H1: "Replace Discord, OmegaFi, and Life360 with one app." — Navy, 64px, weight 800
- Subheadline: Slate-600, 20px, max-width 600px
- Primary CTA: "Get Started Free →" — royal-blue bg, white text, px-8 py-4, rounded-xl, shadow-lg, hover shadow-xl + scale(1.02)
- Secondary CTA: "Watch Demo ▶" — ghost button, royal-blue text, border royal-blue/20
- Hero image: App mockup showing the mobile dashboard (perspective tilt, subtle shadow). Use Next.js Image with priority loading.

**Mobile layout:**

- Text centered, H1 at 40px
- CTAs stacked vertically, full width
- Mockup below CTAs, width 100%

**Background:** Subtle gradient: `bg-gradient-to-b from-slate-50 to-white` (light) or `from-slate-950 to-slate-900` (dark). Optional: faint grid pattern overlay at 3% opacity.

### Section 2: Social Proof Bar

Horizontal strip between hero and features. Provides immediate credibility.

```text
┌───────────────────────────────────────────────────────┐
│  Trusted by chapters at  [University logos / names]   │
│                                                       │
│  "50+ chapters"  •  "2,000+ members"  •  "10k+ events tracked" │
└───────────────────────────────────────────────────────┘
```

- Background: slightly darker than hero (`slate-50` light, `slate-800/50` dark)
- Stats in a row (3 items), each with a large number (count-up animation) and label
- If no real logos yet: use placeholder university names in muted text
- Horizontal scroll on mobile if needed

### Section 3: Feature Highlights

**Six capabilities** in a **single bordered card** with **stacked rows** (`divide-y`), not a 3×2 icon grid. Each row: **icon** (Lucide, `text-primary`) + **title** + **short description** (`text-muted-foreground`).

**Rows (representative copy — adjust in code as product evolves):**

| Icon / area | Title                | Description (intent)                                                                |
| ----------- | -------------------- | ----------------------------------------------------------------------------------- |
| Book        | Backwork Library     | Search study resources by department, course, professor, semester, assignment type. |
| Message     | Real-Time Chat       | Channels, role-gated rooms, announcements, DMs — chapter-native comms.              |
| Calendar    | Events & Attendance  | Self-check-in, role-targeted events, automatic point awards.                        |
| Star        | Points & Leaderboard | Transparent points, audit-friendly ledger, semester-aware rankings.                 |
| Grad cap    | Study Hours          | Verified study sessions in approved geofences with anti-spoof feedback.             |
| Dollar      | Billing & Dues       | Subscription visibility, invoices, payment status for treasurers.                   |

**Container styling:**

- Outer: `rounded-lg border border-border bg-card`, optional `motion-safe:animate-fade-up`
- Rows: `flex` layout, `p-6`, `gap` between icon and text; icon ~`h-8 w-8`

**Section header:**

- Ledger line + overline: e.g. **"Core capabilities"** (`text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground`)
- H2: e.g. **"One ledger for communication, events, points, and dues."** (`text-navy` / `dark:text-white`)

### Section 4: How It Works

3-step horizontal flow (desktop), vertical stacked (mobile).

```text
   ①                    ②                    ③
   Create your       Invite your         Run your
   chapter           members             chapter

   Sign up, pick     Share an invite     Events, chat,
   your plan, and    link. Members       backwork, study
   you're live in    join in one tap.    hours — all in
   under 5 minutes.                     one place.
```

**Styling:**

- Each step: numbered circle (royal-blue bg, white text, 48x48, rounded-full) + title + description
- Connecting line between steps (dashed, slate-300) on desktop
- Steps stagger-animate on viewport entry
- Section bg: `slate-50` (light) / `slate-800/30` (dark) for contrast

### Section 5: App Showcase

Interactive or static showcase of the app in action. Two approaches (pick based on available assets):

**Option A: Side-by-side mockups**

```text
[Mobile app mockup]     [Web dashboard mockup]
     ↑                         ↑
  "Member                  "Admin
   experience"              dashboard"
```

**Option B: Feature tabs**
Horizontal tab bar: Chat | Events | Backwork | Points | Study
Each tab shows a different screenshot/mockup with a brief description alongside.

**Styling:**

- Mockups in device frames (phone frame, browser frame)
- Subtle shadow and rotation (`perspective: 1000px`, `rotateY(-5deg)`)
- Tab bar: pill-shaped active indicator, smooth slide transition

### Section 6: Pricing

Single plan, clean and simple. No confusion.

```text
┌────────────────────────────────────┐
│                                    │
│         [Emerald checkmark]        │
│                                    │
│    $XX / month per chapter         │
│                                    │
│    Everything included.            │
│    No per-seat fees.               │
│    No hidden charges.              │
│                                    │
│    ✓ Unlimited members             │
│    ✓ All features included         │
│    ✓ Chat, events, backwork        │
│    ✓ Study hours & geofencing      │
│    ✓ Points & leaderboard          │
│    ✓ Billing & dues collection     │
│    ✓ Reports & exports             │
│    ✓ Priority support              │
│                                    │
│    [Get Started Free →]            │
│                                    │
│    Free 14-day trial. No card      │
│    required.                       │
│                                    │
└────────────────────────────────────┘
```

**Styling:**

- Single centered card, max-width 480px
- `bg-white` with `border-2 border-royal-blue` (light), `bg-slate-800 border-emerald-500` (dark)
- Price: 48px weight 800 + "/month" in 18px weight 400
- Feature list: emerald checkmarks, 16px, comfortable line-height
- CTA: full-width royal-blue button
- Below card: expandable FAQ accordion (4-6 questions)

**FAQ items:**

1. "How does pricing work?" → Flat monthly per chapter. No per-member fees.
2. "Is there a free trial?" → Yes, 14 days free. No credit card required.
3. "Can we cancel anytime?" → Yes, cancel anytime. Your data is preserved.
4. "What payment methods do you accept?" → All major credit cards via Stripe.
5. "Do you offer a discount for smaller chapters?" → Contact us for custom pricing.
6. "Is my data secure?" → Yes. Encrypted at rest and in transit. See our Privacy Policy.

### Section 7: Testimonials

Quote cards in a horizontal scroll (mobile) or 3-column grid (desktop).

Each card:

```text
┌──────────────────────────────┐
│  "Frapp replaced three apps  │
│  for us. Our chapter is more │
│  organized than ever."       │
│                              │
│  — John D., President        │
│    Alpha Beta Chapter        │
│    State University          │
└──────────────────────────────┘
```

**Styling:**

- `bg-white`, `rounded-2xl`, `p-8`, `shadow-sm`
- Quote in italic, slate-700, 18px
- Attribution: weight 600 for name, weight 400 for chapter/university, slate-500
- Optional: small avatar circle (48x48) next to attribution
- Use placeholder testimonials until real ones are available

### Section 8: Final CTA

Full-width section with high-contrast background.

```text
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   Ready to modernize your chapter?                      │
│                                                         │
│   Join 50+ chapters already using Frapp to run          │
│   smarter, not harder.                                  │
│                                                         │
│   [Get Started Free →]                                  │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

**Styling:**

- Background: `navy` (light) or `slate-800` (dark) — full bleed
- Text: white, centered
- H2: 40px weight 700
- CTA: white bg, navy text (inverted from hero CTA for contrast)
- Generous vertical padding: `py-24`

---

## 4. Legal Pages

### `/terms` — Terms of Service

### `/privacy` — Privacy Policy

### `/ferpa` — FERPA Notice

All three share the same layout:

```text
┌─────────────────────────────────────────┐
│  [Header/Nav — same as main page]       │
│                                         │
│  Terms of Service                       │
│  Last updated: February 2026            │
│                                         │
│  [Legal content — prose layout]         │
│  max-width: 720px, centered             │
│  Typography: 16px/1.8 body, headings    │
│  for sections                           │
│                                         │
│  [Footer — same as main page]           │
└─────────────────────────────────────────┘
```

- Use `@tailwindcss/typography` (`prose`) class for clean legal text rendering
- Table of contents sidebar on desktop (sticky), hidden on mobile
- Scroll-to-section for long documents

---

## 5. Performance Targets

| Metric                         | Target            |
| ------------------------------ | ----------------- |
| Lighthouse Performance         | ≥ 95              |
| LCP (Largest Contentful Paint) | < 2.0s            |
| FID (First Input Delay)        | < 100ms           |
| CLS (Cumulative Layout Shift)  | < 0.1             |
| Total page weight              | < 500KB (gzipped) |
| Time to Interactive            | < 3.0s on 3G      |

**Techniques:**

- Next.js SSG (Static Site Generation) for all pages
- `next/image` with WebP/AVIF auto-format, lazy loading (except hero)
- Font: self-hosted Geist Sans (subset Latin, woff2 only)
- No client-side JavaScript for content rendering (SSG)
- CSS animations preferred over JS animations where possible
- Minimal third-party scripts (analytics only: Plausible or PostHog, async)

---

## 6. SEO & Metadata

Use the **Next.js App Router** `metadata` export in `apps/landing/app/layout.tsx` for `title`, `description`, `metadataBase`, `openGraph`, and `twitter` (card type `summary_large_image`).

**Do not** point `openGraph.images` / `twitter.images` at a static `/og-image.png` unless that file exists in `public/`. The canonical approach is the dynamic route **`apps/landing/app/opengraph-image.tsx`** (1200×630, navy + accent) — see [spec/ui-assets.md](ui-assets.md) §3–4.

Equivalent values (for reference):

| Field            | Value                                                                                                                       |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Title            | Frapp — The Operating System for Greek Life                                                                                 |
| Meta description | Replace Discord, OmegaFi, and Life360 with one app. Chat, events, study hours, points, and billing for fraternity chapters. |
| OG description   | One platform for chat, events, study hours, points, backwork, and billing.                                                  |

- Generate `sitemap.xml` via `next-sitemap`
- `robots.txt` allowing all crawlers
- Structured data: e.g. `SoftwareApplication` JSON-LD in the page when appropriate
