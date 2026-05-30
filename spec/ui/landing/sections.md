# Landing Page — Sections

> The page sections in scroll order, plus the legal pages. Design system, global header/footer, performance, and SEO are in [README.md](README.md); brand tokens and motion in [brand-identity.md](../brand-identity.md).

The landing narrative is **chat-first**: chat is the headline, the free tier is real, and ops modules are positioned as a secondary upgrade story. Every primary CTA routes to `/sign-up`, which hands off into the [onboarding wizard](../web-dashboard/screens.md#chapter-onboarding-wizard).

---

## Section 1: Hero

The most important section — it must communicate the value proposition in under five seconds.

```text
┌─────────────────────────────────────────────────────────┐
│   [Overline: "THE OPERATING SYSTEM FOR GREEK LIFE"]     │
│                                                         │
│   Chapter chat that just works. Free.                   │
│                                                         │
│   [Sub: Add ops when you're ready.]                     │
│                                                         │
│   [Start your chapter →]   [Watch Demo ▶]               │
│                                                         │
│   ┌─────────────────────────────────────┐               │
│   │      [App Mockup — chat surface]    │               │
│   └─────────────────────────────────────┘               │
└─────────────────────────────────────────────────────────┘
```

**Content:**

- Overline: uppercase, tracked, `text-xs` `font-semibold`, muted (or a single moss accent line).
- H1: **"Chapter chat that just works. Free."** — ink, 64px, weight 800, tight tracking.
- Subheadline: **"Add ops when you're ready."** — muted, max-width ~600px.
- Primary CTA: **"Start your chapter →"** — `bg-primary` (deep bronze), `text-primary-foreground`, `px-8 py-4`, rounded; hover via **shadow / border / color** only, no scale. Routes to `/sign-up` → onboarding wizard.
- Secondary CTA: **"Watch Demo ▶"** — ghost button, bronze text, subtle bordered.
- Hero image: an app mockup showing the **chat surface** (the spine of the product). Use `next/image` with priority loading.

**Mobile:** text centered, H1 at 40px, CTAs stacked full-width, mockup below the CTAs at 100% width.

**Background:** flat per the brand anti-patterns — no full-bleed gradient wash as the only visual idea. Prefer solid `background` / `card` tokens with a ledger-line divider; an optional faint grid overlay at low opacity is acceptable.

---

## Section 2: Social proof bar

A horizontal strip between the hero and features for immediate credibility.

- Surface slightly distinct from the hero (alternating `card` tone).
- A row of three stats, each a large number + label; **count-up animation is allowed only here**, and only when displaying real metrics (not placeholder copy).
- If no real logos/metrics yet, use placeholder university names in muted text and mark stats as illustrative per the brand trust rule.

---

## Section 3: Feature highlights — chat-first

Chat is the **headline capability**, presented first and most prominently; ops modules are a secondary "what's possible when you upgrade" grid rather than co-equal cards.

**Lead block — Chat:** a prominent block (not buried in a six-up icon grid) describing chapter-native communication — channels, role-gated rooms, announcements, DMs, and the member-visible audit log. This is what the free tier delivers.

**Secondary grid — "What's possible when you upgrade":** the ops modules as supporting rows in a single bordered card (`divide-y`), each a Lucide icon (`text-primary`) + title + short description:

| Icon | Title | Description (intent) |
| ---- | ----- | -------------------- |
| Calendar | Events & Attendance | Self-check-in, role-targeted events, automatic point awards. |
| Star | Points & Leaderboard | Transparent points, an audit-friendly ledger, semester-aware rankings. |
| Grad cap | Study Hours | Verified study sessions in approved geofences with anti-spoof feedback. |
| Dollar | Billing & Dues | Subscription visibility, invoices, payment status for treasurers. |
| Book | Backwork Library | Search study resources by department, course, professor, semester. |
| Clipboard | Tasks & Workflows | Assign, track, and automate the chapter's recurring ops. |

**Container styling:** outer `rounded-lg border border-border bg-card`, optional `motion-safe:animate-fade-up`. Rows: `flex`, `p-6`, gap between icon and text; icon ~`h-8 w-8`. Row hover uses border/color emphasis (`hover:border-primary/30`) — no scale.

**Section header:** a ledger line + overline ("Core capabilities") over an H2 such as "Start with chat. Add ops when you're ready."

---

## Section 4: How it works

A 3-step horizontal flow (desktop), stacked vertically (mobile).

```text
   ①                  ②                  ③
   Create your        Invite your        Run your
   chapter            members            chapter

   Sign up and your   Share an invite    Chat now; turn on
   chapter is live    link. Members      events, points, dues,
   in minutes.        join in one tap.   and study hours when
                                         you're ready.
```

- Each step: a numbered circle (bronze bg, bone text, 48×48, rounded-full) + title + description.
- A dashed connecting line between steps on desktop. Steps stagger-animate on viewport entry (`motion-safe`).
- Section surface uses an alternating `card` tone for contrast.

---

## Section 5: App showcase

A static or interactive showcase of the app in action — chat front and center.

- **Option A:** side-by-side mockups (mobile member experience + web admin dashboard).
- **Option B:** feature tabs (Chat | Events | Backwork | Points | Study) with a screenshot per tab.
- Mockups sit in device frames with subtle shadow; tab bars use a pill-shaped active indicator with a smooth slide.

---

## Section 6: Pricing — Free vs Chapter Pro

Two tiers, clean and honest. The free tier is real, not a teaser.

```text
┌──────────────────────────┐   ┌──────────────────────────┐
│  Free forever            │   │  Chapter Pro             │
│  $0                      │   │  $XX / chapter / month   │
│                          │   │  (14-day free trial)     │
│  ✓ Chapter chat          │   │  Everything in Free, +   │
│  ✓ Members directory     │   │  ✓ Events & attendance   │
│  ✓ Announcements         │   │  ✓ Points & leaderboard  │
│  ✓ Member-visible        │   │  ✓ Study hours & geo     │
│    audit log             │   │  ✓ Billing & dues        │
│                          │   │  ✓ Tasks & workflows     │
│  [Start your chapter →]  │   │  ✓ Reports & exports     │
│                          │   │  [Start 14-day trial →]  │
└──────────────────────────┘   └──────────────────────────┘
```

- **Free forever:** chat + members + announcements + audit log. CTA "Start your chapter →" → `/sign-up` → wizard.
- **Chapter Pro:** all ops integrations with a **14-day free trial** (no card required). Single paid tier, price per chapter per month (TBD). CTA routes to the same `/sign-up` → wizard.
- **Styling:** two centered cards; the Free card uses a `border border-border` surface, the Pro card a `border-2 border-primary` emphasis. Price 48px weight 800 + cadence in 18px weight 400. Moss checkmarks. CTAs full-width bronze, hover via color/shadow/border only — no scale.
- Below the cards: an expandable FAQ accordion (border/color hover states, no default scale).

**FAQ items:**

1. "Is chat really free?" → Yes — chat, members, announcements, and the audit log are free forever, no card required.
2. "What's in Chapter Pro?" → All the ops modules (events, points, study hours, dues, tasks, reports) with a 14-day free trial.
3. "How does Pro pricing work?" → A flat monthly price per chapter. No per-member fees.
4. "Can we cancel anytime?" → Yes. Your data is preserved.
5. "What payment methods do you accept?" → All major credit cards via Stripe.
6. "Is my data secure?" → Yes. Encrypted at rest and in transit. See our Privacy Policy.

---

## Section 7: Trust signals

A band that reinforces the honest, chapter-controlled positioning:

- **Member-visible audit log** — chapters see what their officers change.
- **A real free tier** — chat is free forever, not a time-limited trial.
- **Chapter-controlled customization** — archetypes, roles, fields, and theming the chapter owns.

Testimonial quote cards (3-column desktop, horizontal scroll mobile) may sit here, using placeholder quotes clearly until real ones are verified per the brand trust rule. Cards: `bg-card`, `rounded-2xl`, `p-8`, `shadow-sm`; hover via border/color only.

---

## Section 8: Final CTA

A full-width, high-contrast section.

```text
┌─────────────────────────────────────────────────────────┐
│   Ready to get your chapter talking?                    │
│                                                         │
│   Start free in minutes — add ops when you're ready.    │
│                                                         │
│   [Start your chapter →]                                │
└─────────────────────────────────────────────────────────┘
```

- Background: full-bleed ink (dark surface). Text bone, centered.
- H2: 40px weight 700.
- CTA: bone bg, ink text (inverted from the hero CTA for contrast), → `/sign-up` → wizard. Generous `py-24`.

---

## Legal pages

`/terms` (Terms of Service), `/privacy` (Privacy Policy), and `/ferpa` (FERPA Notice) share one layout:

```text
┌─────────────────────────────────────────┐
│  [Header/Nav — same as main page]       │
│  Terms of Service                       │
│  Last updated: February 2026            │
│  [Legal content — prose, max-w 720px]   │
│  [Footer — same as main page]           │
└─────────────────────────────────────────┘
```

- Use `@tailwindcss/typography` (`prose`) for clean legal text (16px / 1.8 body).
- A sticky table-of-contents sidebar on desktop, hidden on mobile; scroll-to-section for long documents.
