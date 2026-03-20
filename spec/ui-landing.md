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

**Desktop layout (≥1024px):**

```
[Logo]                    [Features] [Pricing] [Docs]        [Log In]  [Get Started →]
```

- Logo: Frapp lockup SVG (`packages/brand-assets/assets/frapp-lockup.svg` + `apps/landing/components/frapp-lockup.tsx`) — see [ui-assets.md](ui-assets.md)
- Nav links: Regular weight, slate-600 color, hover: royal-blue, transition 150ms
- "Log In": Ghost button (border, transparent bg), links to `app.frapp.live/login`
- "Get Started →": Solid button (royal-blue bg, white text, rounded-lg), links to `app.frapp.live/signup`
- Buttons have hover scale(1.02) + shadow transition

**Mobile layout (<1024px):**

```
[Logo]                                         [☰ Menu]
```

- Hamburger icon opens a full-screen overlay (slide down, 300ms)
- Overlay: white bg, centered nav links (24px each), CTA buttons at bottom
- Close button (X) top-right

**Scroll behavior:**

- Header height: 72px (desktop), 64px (mobile)
- `z-50` to stay above all content
- Transition: `background-color 300ms, box-shadow 300ms`

### Footer

Two sections: links grid + bottom bar.

**Links grid (4 columns on desktop, 2 on tablet, 1 on mobile):**

| Product  | Resources              | Legal            | Company |
| -------- | ---------------------- | ---------------- | ------- |
| Features | Documentation          | Terms of Service | About   |
| Pricing  | API Reference (future) | Privacy Policy   | Contact |
|          | Getting Started        | FERPA Notice     |         |

**Bottom bar:**

```
© 2026 Frapp. All rights reserved.                    [Twitter] [Instagram] [LinkedIn]
```

- Social icons: 24x24, slate-400, hover: royal-blue
- Footer bg: `slate-900` (light mode), `slate-950` (dark mode), text white/slate-300

### Dark Mode Toggle

Small icon button in the header (sun/moon icon). Three states: Light, Dark, System. Click cycles through them. Persisted in `localStorage`.

---

## 3. Page Sections (Scroll Order)

### Section 1: Hero

**The most important section.** Must communicate the value proposition in under 5 seconds.

**Desktop layout:**

```
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

```
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

**6 feature cards** in a 3x2 grid (desktop), 2x3 (tablet), 1x6 stacked (mobile).

Each card:

```
┌──────────────────────┐
│  [Icon]              │
│                      │
│  Feature Name        │
│                      │
│  Short description   │
│  (2-3 lines max)     │
│                      │
└──────────────────────┘
```

**Cards:**

| Icon          | Title                | Description                                                                                                                |
| ------------- | -------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 📚 (book)     | Backwork Library     | Search exams, homeworks, and study guides by course, professor, and semester. Uploaded by brothers, for brothers.          |
| 💬 (chat)     | Real-Time Chat       | Channels, DMs, and announcements — like Discord, built for your chapter. Role-gated channels keep conversations organized. |
| 📅 (calendar) | Events & Attendance  | Create events, track check-ins, auto-award points. Members check in from their phones — no paper sign-in sheets.           |
| ⭐ (star)     | Points & Leaderboard | Gamified engagement. Points for attendance, study hours, and service. Leaderboard drives healthy competition.              |
| 📍 (pin)      | Study Hours          | Geofenced study tracking at approved locations. Members earn points for focused study time — no GPS spoofing.              |
| 💰 (dollar)   | Billing & Dues       | One-click dues collection with Stripe. Invoices, payment tracking, and overdue alerts for treasurers.                      |

**Card styling:**

- `bg-white` (light) / `bg-slate-800` (dark), `rounded-2xl`, `p-8`
- Subtle `border border-slate-200` (light) / `border-slate-700` (dark)
- Hover: `shadow-lg`, `translate-y-[-2px]`, 200ms transition
- Icon: 48x48, in a rounded-xl bg (emerald-50 light / emerald-900/20 dark), emerald-600 color
- Title: H3, Navy, weight 600
- Description: Body Small, slate-600

**Section header:**

- Overline: "EVERYTHING YOUR CHAPTER NEEDS"
- H2: "Six tools, one platform."
- Centered, max-width 600px

### Section 4: How It Works

3-step horizontal flow (desktop), vertical stacked (mobile).

```
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

```
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

```
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

```
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

```
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

```
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

```html
<title>Frapp — The Operating System for Greek Life</title>
<meta
  name="description"
  content="Replace Discord, OmegaFi, and Life360 with one app. Chat, events, study hours, points, and billing for fraternity chapters."
/>
<meta
  property="og:title"
  content="Frapp — The Operating System for Greek Life"
/>
<meta
  property="og:description"
  content="One platform for chat, events, study hours, points, backwork, and billing."
/>
<meta property="og:image" content="/og-image.png" />
<meta property="og:type" content="website" />
<meta name="twitter:card" content="summary_large_image" />
```

- Generate `sitemap.xml` via `next-sitemap`
- `robots.txt` allowing all crawlers
- Structured data: Organization schema (JSON-LD)
