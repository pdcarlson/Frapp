## How to use this

Paste everything below into Claude Design as the opening brief. It's written to be self-contained — Claude Design won't have access to our codebase or this canvas, so all necessary context is included. Goal of this session: lock the **design system** (tokens, type, components, states) before touching individual screens. Screens come after, in a second pass, once the system is approved.

---

## PROMPT START

### What Signet is

Signet is an AI-first operating system for fraternity/sorority chapters — a multi-tenant SaaS replacing the current fragmented mess of Discord + spreadsheets + third-party tools. Core modules: chat, events, points/tasks, study hours (with geofencing), dues/billing, document storage, service-hour tracking, polls. The differentiator is AI: members can ask natural-language questions and get sourced answers pulled from their own chapter's docs, meeting notes, and chat history. Tagline: **"Ask your chapter anything."**

Audience: college students using this daily on their phones, and chapter officers/admins using a fuller web dashboard. Not enterprise software, not developer tooling — it needs to feel approachable, warm, and fast, not clinical.

Platforms: a **web dashboard** (Next.js, Tailwind, shadcn/ui components) and a **native mobile app** (Expo/React Native, NativeWind for styling). Both need to share one token system. Assume the design needs to translate cleanly into both a web component library and React Native — avoid effects that only make sense on web (e.g. complex CSS-only tricks) unless you flag them as web-only.

### Brand identity (already decided, do not re-litigate)

- **Name:** Signet
- **Tagline:** "Ask your chapter anything."
- **Positioning:** owns the AI/RAG whitespace in Greek life software — not competing on "modern UI" alone (that lane is crowded).
- **House color:** warm gold/amber (not blue — avoids collision with Signet Jewelers' blue serif wordmark and a same-name email-security brand that owns a blue checkmark). Exact hex to be finalized in this session, but must read as gold/amber, not brown/bronze.
- **Logo/mark direction (in progress, not final):** lead concept is an "S" monogram built like a seal impression — bold weight, large negative space, works at 16px favicon size — paired with a humanist rounded-sans wordmark. Explicitly avoid: blue, serif type, literal checkmarks, literal rings/wax seals, hexagons, swirls, orbit motifs, blue-to-purple gradients (all read as "generic AI startup" or collide with existing "Signet" brands). The mark and app icon stay in the fixed house color always — they never take a chapter's custom accent color.

### Design direction (already decided, do not re-litigate)

Dark-first, but on the **warm/consumer end of the spectrum** (think Notion dark mode, Cash App) — **not** the colder technical/engineer aesthetic of Linear, Vercel, or Raycast. We deliberately moved off that technical reference point because our users are students, not developers: prioritize readability and warmth over density and cleverness.

Concretely:
- Near-black/charcoal base, but **warmer and slightly lifted**, not stark pure black
- 3–4 surface layers for hierarchy (background → card → popover/modal), shown via progressively lighter surfaces, not drop shadows
- Borders as low-opacity white (e.g. `rgba(255,255,255,0.08)`) rather than fixed hex, so they read correctly under any injected accent color
- **Larger radius than a typical dark SaaS app:** 12–16px default on cards/inputs/buttons, up to 20px on chat bubbles and the AI-answer card specifically
- **Larger type than typical:** 16px+ body text, not 14px
- **Humanist rounded sans font** for UI — not a mono/technical/geometric face, not Geist Sans (that was the old direction, now explicitly rejected)
- Generous line-height for legibility
- **44px+ minimum touch targets everywhere** — this is a phone-first, daily-use app
- One accent color, but used a bit more generously than a typical "restrained SaaS accent" — it can show up in badges, active states, small illustration moments, not just primary buttons — as long as contrast holds

### The per-chapter accent system — this is the hardest and most important constraint

Signet has one fixed neutral dark base (its own identity). Each chapter additionally sets **one accent hex color** (their own official chapter color — often navy, maroon, dark green, gold, etc.) in their settings. That single hex must never be used as a raw solid fill, because many of these colors are dark/low-chroma and would be invisible or fail contrast on a near-black background.

Instead, that one hex gets run through a generator (Radix `generateRadixColors` or Material Color Utilities) that expands it into a full accessible 12-step scale, contrast-guaranteed against the dark base, and mapped onto standard semantic roles (primary button fill, hover, focus ring, subtle background, border, text-on-accent, etc.).

**What I need from you in this session:** don't just design one pretty color scheme. Design the base neutral system, then demonstrate it working with at least **3 sample chapter accent colors** run through this logic — one dark/desaturated (e.g. navy or maroon), one mid-brightness, one that's close to the house gold itself — so I can see the system survives real chapter colors, not just a cherry-picked demo hue. Show primary button, focus ring, active nav item, and a badge in each accent variant.

### Starting palette (a floor to warm up from, not a final answer — refine visually in this session)

| Token | Value | Role |
|---|---|---|
| Background | `#0a0a0a` (warm it up) | App canvas |
| Card | `#1c1c1f` | Elevated surface |
| Popover/modal | `#232326` | Modal, menu, popover |
| Border | `rgba(255,255,255,0.08)` | Hairline divider |
| Border strong / input | `rgba(255,255,255,0.14)` | Input border, emphasis |
| Text primary | `#ededed` | High-contrast text |
| Text secondary | `#a1a1aa` | Secondary text |
| Text muted | `#71717a` | Tertiary/disabled-adjacent |
| Success | `#3fb950` | Positive |
| Warning | `#e5a000` | Caution |
| Destructive | `#f85149` | Danger/error |
| Info | `#2f81f7` | Informational (this is the one place blue is fine — status color, not brand color) |

Note: our current shipped codebase already has a dark-mode accent at hue 34 (amber/gold territory) — so we're not starting from zero warmth, just need to push further and make it the primary story instead of an accident.

### What this replaces (context, not something Claude Design needs to fix — just don't accidentally recreate it)

Our current live product uses a **light-first "bone / bronze / ink"** palette (newspaper-warm neutrals, brown-ish bronze accent, banned gradients, Geist Sans mandated, sidebar that "never inverts"). That whole direction is being intentionally abandoned in favor of the dark-first warm/gold system described above. If any reference material or training data nudges you toward a cooler, more corporate, or brown/bronze palette, push back toward warm gold/amber and dark-first.

### What I need out of this session (deliverables)

1. **Color system:** full neutral dark palette (background/card/popover/border/text tiers), semantic colors (success/warning/destructive/info), and the house gold/amber accent — shown at rest, hover, and pressed states. Then the 3-sample-chapter-color demonstration described above.
2. **Typography scale:** humanist rounded sans recommendation (name 2–3 candidate fonts), full type scale from body (16px+) up through headings, specify weights used (keep it constrained — 3 weights max).
3. **Spacing and radius scale:** confirm/refine the 4px spacing grid and the 12–16px (up to 20px for chat/AI surfaces) radius scale.
4. **Core component states:** buttons (primary/secondary/ghost/destructive, all states), inputs, checkboxes/toggles, badges, cards, tabs, a top nav bar with a search input and a distinct "Ask [Signet]" AI entry-point pill, sidebar nav item (active/hover/default).
5. **Signature surfaces:** a chat message bubble (own message vs. others), and an **AI sourced-answer card** with citation chips — this is our key differentiator surface and should feel distinct/special, not like a generic chat bubble.
6. **State patterns:** redesign loading (content-shaped skeleton, not a generic spinner-in-a-box), empty state, and error state — these should share a family but be visually distinguishable from each other (our current implementation makes all three look nearly identical, which we want to fix).
7. **Mobile-specific:** a bottom tab bar (5 items) and a bottom sheet component (used for creation flows like adding a task or logging study hours) — confirm touch target sizing and how radius/elevation adapts on mobile.

### Output format note

I know Claude Design exports as HTML/zip/PDF, not machine-readable design tokens. Please also give me a **plain-written token spec** at the end — exact hex or OKLCH values, exact spacing/radius numbers, exact font names and weights, with a short rationale for each major decision — in a format I can manually transcribe into our codebase's token file. Visual screens alone aren't enough; I need the numbers spelled out explicitly.

## PROMPT END

---

### After this session

Once you've got output from Claude Design: bring the visual results and the written token spec back here. Next steps from there will be (1) rewriting `spec/ui/brand-identity.md` as the new source of truth, (2) updating `packages/theme` tokens to match, then (3) fanning out the reskin work per-module as already scoped in phase 02 (see "Cutover process" blob). Don't treat anything from Claude Design as final — it's a starting point for you to react to and refine, same as everything else in this project.