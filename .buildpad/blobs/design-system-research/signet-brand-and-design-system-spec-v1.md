## Name and positioning

**Name:** Signet (replaces "Frapp")

**Tagline:** "Ask your chapter anything."

**Positioning:** AI-first operating system for Greek life. Compete on owning the AI/RAG whitespace (AI search over chapter docs, meeting notes, and chat history) — nobody else in the Greek software space does this. Do not compete on "modern UI" alone; that lane is already crowded (Dueflow, MyGreek, Greekly, GreekDash, OurHouse).

**Open action:** run a formal USPTO/TESS trademark search on "Signet" before locking a logo or spending on merch/legal filings.

## Design direction

Dark-first base, softer/consumer aesthetic (Notion/Cash App lane, not Linear/Vercel/Raycast technical lane) — audience is college students, not engineers. Readability and warmth over cleverness and density.

**Reference apps:** Notion (dark mode) and Cash App as the primary north stars for warmth/approachability. Linear, Vercel, and GitHub dark mode as reference for restraint principles (surface layering, hairline borders, sparing accent use) even though their overall feel is more technical than what we want.

## Core design principles

- Dark-first: near-black/charcoal base, not stark pure black — slightly warmer/lifted than a technical reference app
- 3-4 surface layers for hierarchy (background, card, popover/modal), elevation shown via lighter surfaces, not drop shadows
- Borders as low-opacity white (`rgba(255,255,255,0.08)`) rather than fixed hex, so they read correctly under any chapter accent
- One accent color per chapter, used generously enough to feel personal (badges, active states, small illustration moments) but never as the base UI color
- Large, legible type (16px+ body), humanist rounded sans font (not mono/technical), generous line-height
- Generous touch targets (44px+ minimum) — this is a phone-first daily-use app
- Radius: 12-16px default, up to 20px on chat bubbles and AI-answer cards

## Starting palette (base/fixed, pre-softening adjustment — treat as a floor to warm up from)

- Background: `#0a0a0a` (lift slightly warmer in final execution)
- Card: `#1c1c1f`
- Popover/modal: `#232326`
- Border: `rgba(255,255,255,0.08)`, stronger border/input: `rgba(255,255,255,0.14)`
- Text primary: `#ededed`
- Text secondary: `#a1a1aa`
- Text muted: `#71717a`
- Success: `#3fb950` / Warning: `#e5a000` / Destructive: `#f85149` / Info: `#2f81f7`

Note: verify all semantic colors at 4.5:1 contrast against the final background before locking.

## Per-chapter accent model

Signet has its own fixed base identity (the palette above). Each chapter sets one accent hex (their official chapter color) in tenant settings. That hex is never used directly as a solid fill — many fraternity colors (navy, maroon, dark green) would be invisible or fail contrast on a dark base.

Instead, run the hex through a generator (Radix's `generateRadixColors` recommended, or Material Color Utilities) to produce a full 12-step accessible scale with guaranteed contrast. Map the generated scale onto shadcn/ui's existing semantic token names (`--primary`, `--ring`, `--accent`, etc.) so all existing components retint automatically with no per-component work.

Architecture: base tokens + accent-generation function live together in `packages/theme`, shared by web (Tailwind, CSS custom properties injected per tenant in the root layout) and mobile (NativeWind, via its provider-based dynamic theming — flagged as less mature than web's dark-mode toggle, budget extra integration time there).

## Still open / to refine visually

- Exact final hex values and warmth adjustment (founder refining in Claude Design)
- Font selection (humanist rounded sans — candidates to explore, not yet chosen)
- Logo/mark for "Signet" (ties to trademark search outcome)