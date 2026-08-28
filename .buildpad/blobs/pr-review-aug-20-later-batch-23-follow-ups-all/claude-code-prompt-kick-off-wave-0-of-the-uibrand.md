Run this in Claude Code, local, supervised, one session. This is Wave 0 of the UI/brand cutover — shared/hotspot files (the theme system, nav config) that every later per-module reskin depends on. Must be serialized and fully merged before any parallel reskin work starts on events/tasks/points/study/dues/backwork/chat.

Sync `.buildpad/` to current before starting and confirm the two source documents below are actually present in it (known recurring gap) — if not, use the content pasted here instead of trusting a stale copy.

---

## Context

Two pieces of research are locked enough to implement now:

**Design system** (`.buildpad/` — "Signet brand and design system spec v1"): dark-first base, 3-4 surface layers, borders as low-opacity white (`rgba(255,255,255,0.08)`) not fixed hex, one accent color per chapter run through a generator (Radix `generateRadixColors` or Material Color Utilities) onto shadcn's existing semantic token names, radius 12-16px default / up to 20px on chat bubbles and cards, 16px+ body type, 44px+ touch targets, humanist rounded sans font. Starting palette values are in the doc — **treat every hex as a provisional floor, not final** (font choice, exact warmth/hex, and logo are explicitly still pending a separate Claude Design pass from Paul — do not invent or lock those, structure the tokens so swapping them later is a one-file change).

**Navigation restructure** (`.buildpad/` — "Navigation and information architecture for a multi-module chapter app"): collapse the web sidebar from 7 sections/16 items to a Chat anchor + 3 member sections (Chapter: events/tasks/points/study hours/service hours; Resources: documents/backwork; Directory: members+alumni as a tab; Finance: dues) + a role-gated Admin group (roles, study zones, reports, settings). Profile moves out of top nav into a bottom-left account menu. Mobile tab bar becomes Home/Chat/Events/Tasks/More (drop standalone Points and Profile tabs). Global search and the AI "Ask" pill both live in a persistent top bar, Cmd/Ctrl+K bound to the search, never a mobile tab slot.

## Step 1 — verify current state before changing anything

A lot has landed since this was researched (`@repo/formatting`, `@repo/hooks` consolidation, chat-core extraction, tenant-scope hardening). Read `packages/theme`, the chapter-theme package, and the current `nav-config.ts` (web) and mobile tab layout fresh. Confirm what's already correct vs what needs to change — don't assume the Aug 13 audit's findings still hold without checking.

## Step 2 — apply the design token layer

Update `packages/theme` (shared by web Tailwind + mobile NativeWind) to the structure above: base dark palette as CSS custom properties / Tailwind tokens, border-as-opacity pattern, radius scale, type scale, touch-target minimums. Confirm or build the per-chapter accent-generation function (hex in → 12-step accessible scale out → mapped onto shadcn's `--primary`/`--ring`/`--accent` etc.) so every existing component retints with no per-component work. Flag explicitly if mobile's NativeWind dynamic theming needs more integration work than web's — the research expected this.

## Step 3 — restructure navigation

Rewrite `nav-config.ts` (web) per the table in the research doc. Move Profile to an account menu. Add the role-gated Admin group. Update the mobile tab bar to Home/Chat/Events/Tasks/More. Add the persistent top-bar search + Ask pill shell (Ask can stay a "coming soon" stub per earlier AI-UI research — don't build real RAG here).

## Explicitly out of scope

- Exact accent hex, font family, logo/mark — pending Paul's Claude Design pass. Use placeholder-but-structurally-correct values.
- The Frapp → Signet rename — parked indefinitely, don't touch.
- Any per-module screen redesign (event modal, chat, etc.) — that's Wave 1, separate prompts, after this merges.

## Report back

What changed, screenshots/description of the token output if possible, confirmation nav restructure matches the table, test results (`check-types`, both app lints, `check:dep-cruiser`, visual regression baseline status — flag if Playwright snapshots need regenerating and do NOT regenerate them yourself, that corrupts the pinned CI baseline). File any new debt as real issues.