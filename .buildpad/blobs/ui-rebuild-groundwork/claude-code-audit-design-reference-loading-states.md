I'll start by getting oriented in the repo, then run both audits.

Repo is clean on the right branch. Let me read the Part A material.

The design-reference README describes a `project/` subdirectory that isn't in the listing. Let me verify the actual structure and read the rest.

The design-reference README points at `project/`, `chats/chat1.md`, `spec/redesign-context.md`, and `docs/internal/redesign/chunks/` — none of which exist. Let me read the actual content.

The design-reference `styles.css` was actually implemented — `packages/theme/src/globals.css` carries its exact token values. Let me check the dark block and fonts, then start Part B.

Now let me enumerate the dashboard routes and every loading-state usage.

A `Skeleton` primitive exists but is used in exactly one non-route file. Let me map routes to components and hunt for artificial delays.

No artificial minimum-delay in any loading path — all `setTimeout` calls are debounce, toast, or retry logic. Let me confirm the network layer and check the outlier routes.

Confirmed the screenshot case. Let me read the resilience spec (which ties both parts together) and the microcopy source.

16 real routes (18 `page.tsx` minus 2 redirects). Let me check the reports outlier and the chat page's actual network cost.

Found content-shaped skeletons already exist — but only in sidebar chrome. Let me check the data hooks and API timeout config.

Let me finish Part A's remaining specs and inventory the empty states for Part B.

Key finding: `components.md` already specifies a `LoadingSkeleton` ("Shimmer placeholder matching each page layout"). Let me verify a few contradictions and count per-route query fan-out.

Found it: the OG image still ships the **old royal-blue palette**. Let me capture the exact loading gate for each route to build the table.

One more check — `isPending` stays true forever on a disabled TanStack query, which would be an infinite spinner. Let me verify no route hits that.

Found a real defect. Let me confirm the scope of the disabled-query spinner trap.

Audit complete. Here's the report, formatted for pasting into your Buildpad chat.

---

# Frapp — Design Reference & Loading-State Audit

Read-only. No files changed. Branch `claude/design-audit-loading-states-2nkh3g` at `6174ddd`.

---

# Part A — Existing design reference material

## A1. Verdict up front

**This is not stale exploration. It shipped.** The `docs/internal/design-reference/styles.css` prototype was ported essentially verbatim into `packages/theme/src/globals.css`, which is the live theme for both Next apps. The `spec/ui/` docs describe the system that is actually running in production today.

That makes it *more* of a problem for the new direction, not less. It's not dead material you can ignore — it's the current source of truth that the new direction has to explicitly supersede, in code and in docs.

| Question | Answer |
| --- | --- |
| Is it real, usable design direction? | Yes — implemented, coherent, internally cross-referenced |
| Is it stale/abandoned? | Only the `docs/internal/design-reference/README.md` navigation and a few asset references |
| Does it contradict the new direction? | **Yes, fundamentally** — it is light-first, brown/bronze, Geist Sans |

## A2. Inventory

| Path | Lines/size | Last commit | What it is | Status |
| --- | --- | --- | --- | --- |
| `spec/ui/README.md` | 15 | 2026-08-07 | Index of the 5 UI specs | Accurate |
| `spec/ui/brand-identity.md` | 135 | 2026-08-07 | **Canonical cross-app identity.** Palette, motifs, type, motion, anti-patterns | Live, authoritative |
| `spec/ui/assets.md` | 4.2 KB | 2026-08-07 | Logos, favicons, OG, brand-asset sync | Live, one stale block |
| `spec/ui/resilience.md` | 18 KB | 2026-08-09 | Network resilience, delivery guarantees, timeouts, perf budgets | Live, partly unimplemented |
| `spec/ui/web-dashboard/README.md` | 10 KB | 2026-08-07 | Shell, sidebar, header | Live |
| `spec/ui/web-dashboard/layout.md` | 4.2 KB | 2026-08-07 | Tokens, dashboard type scale, breakpoints | Live |
| `spec/ui/web-dashboard/components.md` | 2.8 KB | 2026-08-07 | ShadCN install set + custom component list | Live, **partly unbuilt** |
| `spec/ui/web-dashboard/screens.md` | 31 KB | 2026-08-09 | Per-screen specs: chat, members, events, points, billing, settings, onboarding | Live, very current |
| `spec/ui/web-dashboard/state.md` | 8 KB | 2026-08-07 | TanStack Query patterns, offline, a11y | Live |
| `spec/ui/landing/README.md` | 7.8 KB | 2026-08-07 | Landing design system, header/footer, SEO | Live |
| `spec/ui/landing/sections.md` | 11 KB | 2026-08-07 | 8 sections in scroll order + legal | Live |
| `docs/internal/design-reference/` | 8,399 lines JSX + 1,322 CSS | 2026-08-07 | Prototype bundle from claude.ai/design | Mixed — see A4 |

## A3. What the specs actually say

### `brand-identity.md` — the contradiction is explicit and load-bearing

This file is the single source of truth and it commits hard to the *old* direction:

- `brand-identity.md:12` — **"Aesthetic: Bone / bronze / ink — newspaper-warm neutrals, deep bronze accent, ink sidebar. No royal blue anywhere in chrome."**
- `brand-identity.md:38` — moves the palette "from royal-blue + navy to bone / bronze / ink"
- `brand-identity.md:74` — **"Geist Sans as the single UI family"** (geometric-neutral, not humanist rounded)
- `brand-identity.md:26` — "**No** soft gradient hero washes or glassmorphism"; flat surfaces, border-defined depth
- `brand-identity.md:106` — primary CTAs use bronze, never emerald, never royal blue

The palette in `packages/theme/src/globals.css:26-46` matches the prototype token-for-token (bone `40 20% 97%`, deep bronze `30 45% 32%`, moss `145 35% 32%`).

### `components.md` — already specifies the thing Part B says is missing

`spec/ui/web-dashboard/components.md:22` lists `skeleton` in the ShadCN install set, and the custom-component table specifies:

> `LoadingSkeleton` — **Shimmer placeholder matching each page layout**

And `components.md:44`:

> **Empty / loading / error states are first-class.** Every list, channel, search, and panel renders an explicit empty, loading, and error state rather than a blank surface

**The spec already mandates content-shaped skeletons. The implementation never built them.** This is a build gap, not a spec gap — see Part B.

One internal contradiction: `screens.md:16` sanctions the opposite for chat specifically — "*loading → spinner*". That single clause is what the current chat implementation matches.

### `resilience.md` — good spec, partly fictional

`resilience.md:230-240` defines a per-endpoint timeout table (GET 15s, POST 20s, upload 60s, chat send 10s). **No timeout is implemented anywhere** — `packages/api-sdk/src/*.ts` contains no `timeout`, `AbortSignal`, or `AbortController`. The only abort in the web app is the 5s health-check probe at `apps/web/lib/providers/network-provider.tsx:58`.

`resilience.md:484-493` sets perf budgets (API response display < 500ms, route transition < 300ms). No instrumentation found to measure against them.

## A4. `docs/internal/design-reference/` — the prototype bundle

35 files: `styles.css` (1,322 lines), 19 JSX mockups (8,399 lines), 8 logo SVGs, 5 screenshots, `index.html`, `logos.html`.

**The README is the stale part.** `docs/internal/design-reference/README.md` describes a directory layout that does not exist:

| README claims | Reality |
| --- | --- |
| `project/styles.css`, `project/shell.jsx`, etc. | Files are at the top level — no `project/` dir |
| `chats/chat1.md` — "the design conversation transcript" | **Missing** |
| `BUNDLE_README.md` | **Missing** |
| `spec/redesign-context.md` — "where they disagree, the redesign context wins" | **Missing** |
| `docs/internal/redesign/chunks/` — "each chunk brief lists which files to read" | **Missing** |

So the README points at a governance layer (redesign context, chunk briefs, design transcript) that has been deleted. Every "read this when a design choice is ambiguous" pointer is dead.

**The mockups themselves are dead code but were genuinely harvested.** Nothing imports them — no build config references `design-reference`, and `index.html` loads React 18 UMD + Babel standalone from unpkg, so it's a browser-only prototype. But two of them demonstrably shipped:

- `styles.css` → `packages/theme/src/globals.css` (verbatim token values)
- `org-config.jsx` → `packages/org-archetypes/src/index.ts:4` says "TypeScript port of docs/internal/design-reference/org-config.jsx", and `@repo/org-archetypes` has 20 import sites across `apps/` and `packages/`

## A5. Reuse vs. contradicts

### Worth reusing

| Asset | Why | Citation |
| --- | --- | --- |
| **The dark palette is already close to your target** | Dark-mode primary is `hsl(34 55% 68%)` — hue 34 is amber/gold territory, not brown. `--side-accent` in dark is the same value. You may be closer to gold-on-dark than you think | `styles.css:102`, `globals.css` `.dark` block |
| **`--hue-amber: hsl(34 75% 48%)`** | An amber already exists in the category-hue ramp in both prototype and live theme | `styles.css:64`, `globals.css:81` |
| **Radius scale (3/5/7/9/12px)** | Tight and unopinionated; survives an aesthetic change intact | `styles.css:68-72`, `brand-identity.md:77` |
| **Skeleton shimmer CSS** | Already written, with a dark variant, and unused | `styles.css:607-620` |
| **`.state` empty/error pattern** | Dashed border, 52px icon circle, title + body + action, plus a `.state__reqid` monospace request-ID line the React version dropped | `styles.css:582-605` |
| **Motion budget** | No entrance animation on LCP text, 220ms chrome, hover = color/border only, `prefers-reduced-motion` respected. Aesthetic-neutral | `brand-identity.md:85-95` |
| **`components.md` component contract** | The `LoadingSkeleton` / `EmptyState` / `ErrorState` / `OfflineBanner` contract is right; only the visual skin needs replacing | `components.md:31-38` |
| **All of `screens.md`** | Per-screen *behavior* (virtualized timeline, 5-min author grouping, `_status` pending/confirmed/failed, jump-to-unread, slash-palette fails closed) is implementation-level and aesthetic-independent | `screens.md:9-280` |
| **`resilience.md` §2 connection state machine** | ONLINE/DEGRADED/OFFLINE model is sound and partly built | `resilience.md:17-68` |

### Directly contradicts the new direction

| Contradiction | Where | Severity |
| --- | --- | --- |
| **Light-first is baked into the file header** — "Light-first. No blue anywhere." | `styles.css:1-3` | Foundational |
| **Bone background as the default `:root`** — dark is the override branch | `globals.css:26`, `styles.css:8` | Foundational |
| **"Bone / bronze / ink" is stated as the aesthetic** in the canonical identity doc | `brand-identity.md:12` | Foundational |
| **Deep bronze `hsl(30 45% 32%)` as light primary** — this is the brown you're moving off | `globals.css:33`, `styles.css:25` | High |
| **Geist Sans mandated as the single UI family** | `brand-identity.md:74`, `tailwind.config.ts:116`, loaded in both `app/layout.tsx` | High — a humanist rounded sans means swapping the bundled font file |
| **"Newspaper-warm," ledger-line, micro-label motifs** — an editorial/ledger register, not warm/consumer | `brand-identity.md:20-32` | Medium — reads as restrained, not friendly |
| **Anti-pattern list bans gradient washes and glassmorphism outright** | `brand-identity.md:26`, `102` | Medium — likely too strict for a warm consumer look; needs an explicit amendment |
| **Sidebar "never inverts with light/dark mode"** | `brand-identity.md:45`, `68`, `web-dashboard/README.md` | Medium — the always-dark-sidebar rule is meaningless once the whole app is dark-first, and the sidebar will need a new way to separate from content |

### Stale — fix regardless of direction

| Issue | Where |
| --- | --- |
| **The OG image is still the old royal-blue palette.** `#0F172A` navy background, `#60A5FA` royal blue border and text. This is live and ships on every shared marketing link — it directly violates `brand-identity.md:12` "no royal blue anywhere" | `apps/landing/app/opengraph-image.tsx:28,44,45,49,67` |
| `assets.md` documents that blue OG as correct — "aligned with navy `#0F172A` + accent `#60A5FA`" | `spec/ui/assets.md:39` |
| `assets.md` still tells you to use `text-navy` / `dark:text-white` on the lockup | `spec/ui/assets.md:38` |
| Design-reference README points at 5 missing files/dirs | `docs/internal/design-reference/README.md:5,16,17,21` |
| Prototype loads Geist **Mono** webfont from Google Fonts; `brand-identity.md:81` explicitly forbids bundling a mono webfont | `design-reference/index.html:8` vs `brand-identity.md:81` |

**Bottom line for Part A:** treat `spec/ui/brand-identity.md` as the file the new direction has to overwrite — it is referenced by every other UI spec as authoritative, so changing it propagates. The behavioral specs (`screens.md`, `resilience.md`, `state.md`, `components.md`) survive a re-skin nearly untouched. The `docs/internal/design-reference/` JSX bundle has already been harvested for everything it was going to give; its README is misleading enough that it's worth either fixing or deleting.

---

# Part B — Loading and empty states across web

## B1. Verdict up front

**There are zero content-shaped skeletons in any of the 16 dashboard routes.** Every route-level loading state in the app is the same component: a centered spinner in a dashed box with a text label.

There is **no artificial minimum delay anywhere.** No `setTimeout` gates any loading state. What makes loads feel slow is real: multi-query AND-gates, a 7-second retry backoff, and no request timeouts.

## B2. The single loading component

`apps/web/components/shared/async-states.tsx` exports four components. The loading one is 8 lines:

```tsx
// async-states.tsx:6-13
export function LoadingState({ message = "Loading data..." }: { message?: string }) {
  return (
    <div className="flex min-h-52 flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border bg-card p-6 text-center">
      <LoaderCircle className="h-6 w-6 animate-spin text-primary" />
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
```

`min-h-52` = 208px fixed height, centered, dashed border — regardless of what replaces it. `EmptyState` (`:15`), `ErrorState` (`:40`), and `OfflineState` (`:63`) use the identical shell, so all four states are visually near-identical apart from icon and border color.

**A `Skeleton` primitive already exists and is used by zero routes.** `apps/web/components/ui/skeleton.tsx` is the stock ShadCN `animate-pulse rounded-md bg-primary/10` div. The only file that mentions it is `components/shared/can.tsx:12` — and that's a comment explaining why permission gates deliberately *don't* use one.

## B3. All 16 routes

18 `page.tsx` files under `app/(dashboard)/`, minus 2 redirects (`page.tsx:4` → `/chat`, `roles/page.tsx:6` → `/settings?tab=roles`) = **16 real routes**.

**Shape column:** *Full-page* = early `return` that replaces the entire layout including page header. *Scoped* = rendered inside a card/section, so the page header and controls survive.

| # | Route | Gate | Message | Shape | Queries AND-gated |
| --- | --- | --- | --- | --- | --- |
| 1 | `/alumni` | `alumni-directory.tsx:176` | "Loading alumni directory..." | Scoped | 1 |
| 2 | `/backwork` | `backwork-page.tsx:796` | "Loading backwork..." | Scoped | 1 ⚠️ |
| 3 | `/billing` | `app/(dashboard)/billing/page.tsx:144` | "Loading billing overview..." | **Full-page** | **3** (`:65-68`) |
| 4 | `/chat` | `chat-shell.tsx:182` | "Loading chapter channels…" | **Full-page** | **2** (`:181`) |
| 5 | `/documents` | `documents-page.tsx:284` | "Loading chapter documents..." | **Full-page** | 1 |
| 6 | `/events` | `events-page.tsx:172` | "Loading chapter events..." | **Full-page** | 1 |
| 7 | `/geofences` | `geofences-admin-page.tsx:307` | "Loading study zones..." | **Full-page** | 1 |
| 8 | `/members` | `app/(dashboard)/members/page.tsx:291` | "Loading live chapter member records..." | **Full-page** | 1 |
| 8b | `/members` | `app/(dashboard)/members/page.tsx:310` | "Loading roles and points…" | **Full-page** (second sequential gate) | **2** |
| 9 | `/points` | `app/(dashboard)/points/page.tsx:157` | "Loading points ledger..." | **Full-page** | **2** (`:60`) |
| 10 | `/polls` | `polls-page.tsx:355` | "Loading chapter polls..." | Scoped | 1 ⚠️ |
| 11 | `/profile` | `profile-panel.tsx:85` | "Loading your profile..." | **Full-page** | 1 |
| 12 | `/reports` | — | *none* | No route-level loading state | 0 |
| 13 | `/service` | `service-page.tsx:371` | "Loading service entries..." | **Full-page** | 1 |
| 14 | `/settings` | `settings-page.tsx:186` | "Loading chapter settings..." | **Full-page** | 1 |
| 15 | `/study` | `study-page.tsx:424` | "Loading study zones..." | **Full-page** | **2** |
| 16 | `/tasks` | `tasks-board.tsx:288` | "Loading chapter tasks..." | **Full-page** | 1 |

Plus the route-group fallback: `app/(dashboard)/loading.tsx:4` renders `<LoadingState message="Loading dashboard view..." />` — the Next.js suspense boundary for *every* dashboard navigation is also a bare spinner.

**Tally: 15 of 16 routes use spinner-only. 12 replace the entire page. 0 use a skeleton.**

`/reports` is the one route with no route-level loading state, and that's correct — it's a form driving a mutation, with inline button spinners at `reports-page.tsx:606,617,638`.

### Nested spinners inside routes

Seven more `LoadingState` call sites below the route level, all spinner-only:

| Location | Message | Context |
| --- | --- | --- |
| `chat/message-timeline.tsx:69` | "Loading messages…" | Replaces the message list |
| `chat/slash-palette.tsx:82` | "Loading commands…" | Inside the cmdk dialog |
| `events/attendance-panel.tsx:244` | "Loading attendance..." | Attendance roster |
| `points/points-audit-card.tsx:185` | "Loading audit transactions..." | Transaction table |
| `settings/settings-page.tsx:368` | "Loading chapter configuration..." | `renderConfigGated()` wrapper |
| `settings/settings-page.tsx:518` | "Loading archives..." | Semester archive list |
| `settings/settings-fields-tab.tsx:88` | "Loading custom fields..." | Custom-fields tab |
| `settings/settings-roles-tab.tsx:368` | "Loading custom roles..." | Roles tab |

Note `/chat` can show **two spinners in sequence**: `chat-shell.tsx:182` for channels, then `message-timeline.tsx:69` for messages. Same for `/members` (`:291` then `:310`) and `/settings` (`:186` then `:368`).

## B4. The chat page specifically (your screenshot)

```tsx
// chat-shell.tsx:181-183
if (channelsQuery.isPending || categoriesQuery.isPending) {
  return <LoadingState message="Loading chapter channels…" />;
}
```

What eventually renders is a three-column grid — `chat-shell.tsx:205`:

```tsx
<div className="grid gap-4 md:grid-cols-[260px_1fr_300px]">
```

So a 260px channel rail + flexible timeline + 300px member rail collapses to a single 208px-tall centered dashed box. Nothing about the loading state predicts the layout. That's the mismatch in your screenshot, and it's the structurally worst case in the app because chat is the widest layout and the default landing route (`app/(dashboard)/page.tsx:4` redirects `/` → `/chat`).

It's also a **2-query AND-gate**: both `useChannels` and `useCategories` must resolve before *anything* renders, even though `useCategories` only affects channel grouping in the left rail.

## B5. Load times — what's real vs. artificial

### Artificial delay: none

I checked every `setTimeout` in `app/`, `components/`, `hooks/`, `lib/`. All 12 are legitimate:

| Site | Purpose |
| --- | --- |
| `dashboard-command-menu.tsx:190`, `chapter-wizard.tsx:104` | Search debounce |
| `chapter-wizard.tsx:268` | "Copied" feedback reset (2s) |
| `hooks/use-toast.ts:57,64` | Toast auto-dismiss |
| `lib/providers/network-provider.tsx:58` | Health-check abort (5s) |
| `lib/chat/use-chat-channel.ts:183,195` | Draft autosave |
| `lib/chat/realtime-manager.ts:125,146,508,612` | Realtime reconnect backoff, poll degradation |

**No minimum-display-time, no artificial spinner floor.** The perceived slowness is real latency plus the structural issues below.

### Real cost drivers

**1. Retry backoff — up to 7 seconds of pure waiting before an error appears.**

`apps/web/lib/providers/query-provider.tsx:12-13`:

```tsx
retry: 3,
retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 30_000),
```

4 total attempts with 1s + 2s + 4s of backoff. On a failing endpoint the user watches the spinner for **~7 seconds of backoff plus 4 round trips** before `ErrorState` renders. Nothing surfaces "retrying" in the meantime.

**2. No request timeout anywhere.**

`packages/api-sdk/src/*.ts` has no `timeout`, `AbortSignal`, or `AbortController`. A hung connection spins until the browser's default TCP timeout. `spec/ui/resilience.md:230-240` specifies GET 15s / POST 20s / upload 60s — **none implemented.**

**3. Multi-query AND-gates.** `/billing` waits on 3 queries (`billing/page.tsx:65-68`), `/chat`, `/points`, `/study`, and `/members`' second gate each wait on 2. Slowest query sets the wall clock for the whole page.

**4. Sequential gate chains.** `/members` renders the members spinner, then swaps to a *different* spinner with different text for roles + leaderboard (`members/page.tsx:291` then `:310`). Two spinner phases before any content.

**5. Query counts per route** (hook call sites, upper bound on parallel requests):

| Route | Hooks | | Route | Hooks |
| --- | --- | --- | --- | --- |
| `/members` | 20 | | `/service` | 17 |
| `/study` | 18 | | `/settings` | 17 |
| `/backwork` | 17 | | `/tasks` | 15 |
| `/documents` | 13 | | `/chat` | 12 |
| `/points` | 12 | | `/events` | 10 |
| `/geofences` | 9 | | `/polls` | 9 |
| `/alumni` | 7 | | `/billing` | 7 |
| `/profile` | 7 | | | |

### What softens it

`staleTime` is 30s globally (`query-provider.tsx:10`) and 60s on chat, documents, geofences, and backwork hooks (`use-chat.ts:15,96`, `use-documents.ts`, `use-study.ts`, `use-backwork.ts`). `gcTime` is 10 minutes. **Re-navigating to a route within the stale window renders instantly with no spinner** — so the spinner is a cold-load and tab-return phenomenon, not every navigation.

I could not measure actual wall-clock latency: no perf instrumentation exists in the app, and the local API stack wasn't required for this read-only audit. The numbers above are configured knobs and structural fan-out, not measured timings.

## B6. Two routes can spin forever

A disabled TanStack Query v5 stays `status: 'pending'` indefinitely — `isPending` is `true` while `fetchStatus` is `'idle'`. Two routes gate on `.isPending` for a conditionally-enabled query, with no guard for the disabled case.

**`/polls` — a member without `polls:view_all` sees the spinner permanently.**

```tsx
// packages/hooks/src/use-polls.ts:48
enabled: !!chapterId && permissionsQuery.isSuccess && canList,
```

```tsx
// apps/web/components/polls/polls-page.tsx:355
{pollsQuery.isPending ? (
  <LoadingState message="Loading chapter polls..." />
) : pollsQuery.isError ? (
```

If `canList` is false the query never runs, `isPending` never flips, and the spinner never resolves. The `ErrorState` immediately below at `:359-361` even says *"confirm you have polls:view_all access"* — but that branch is unreachable in exactly the case it was written for, because `isPending` short-circuits first.

**`/backwork` — same shape, on chapter ID.** `use-backwork.ts:28` is `enabled: !!chapterId`, and `backwork-page.tsx:796` gates on `resourcesQuery.isPending`. The component has no `if (!activeChapterId)` guard — grep found none. `chat-shell.tsx:168` and `settings-page.tsx:171` both have that guard; backwork, tasks, service, and study don't. Only backwork is exposed, because `useTasks`, `useServiceEntries`, `useGeofences`, and `useDocuments` have no `enabled:` clause.

## B7. Empty states — better shape, same skin

24 `EmptyState` call sites across 20 files, 23 `ErrorState`, 5 `OfflineState`. Coverage is good — most lists have one. Two structural notes:

- **All four states share one visual shell.** `async-states.tsx:8, 27, 50, 75` are the same dashed 208px centered box. Loading, empty, error, and offline are distinguishable only by icon and border tint. The `styles.css:582-605` prototype had more differentiation, including a `.state__reqid` monospace request-ID line for errors that the React version dropped.
- **Microcopy is half-centralized.** `apps/web/lib/state-microcopy.ts` covers only `members`, `events`, `points`, `billing`. The other 12 routes inline their strings at the call site. Result: inconsistent punctuation across the app — "Loading chapter channels…" (ellipsis char) vs "Loading chapter documents..." (three periods). Both forms appear at `chat-shell.tsx:182` and `documents-page.tsx:284`.

## B8. The precedent already exists in the codebase

Content-shaped skeletons are already implemented — in sidebar chrome only, using inline `animate-pulse` divs rather than the `Skeleton` component:

```tsx
// components/layout/dashboard-shell.tsx:134 — subscription block
<div className="mt-2 h-3 w-3/4 animate-pulse rounded-xs bg-side-bg" />
```

```tsx
// components/layout/chapter-lockup.tsx:116-117 — chapter name + school
<span className="block h-3 w-2/3 animate-pulse rounded-xs bg-side-bg" />
<span className="mt-1.5 block h-2 w-1/2 animate-pulse rounded-xs bg-side-bg" />
```

These are sized to the text they replace and preserve the surrounding layout — exactly the pattern missing from all 16 routes. So the team knows how to do this; it just stopped at the sidebar.

Additionally, `styles.css:607-620` already contains a shimmer keyframe animation with a dark-mode variant that was never ported to the React app.

---

# Where A and B meet

`spec/ui/web-dashboard/components.md:22` and `:35` already specify a `LoadingSkeleton` component — "shimmer placeholder matching each page layout" — plus `skeleton` in the ShadCN install set. The ShadCN primitive was installed (`components/ui/skeleton.tsx`) and then never wired into a single route. `styles.css:607-620` has the shimmer CSS. `dashboard-shell.tsx:134` proves the pattern works.

So the content-shaped-skeleton work is **spec-sanctioned, primitive-installed, precedent-established, and unbuilt** — the only thing pointing the other way is one clause at `screens.md:16` that says chat loading should be a spinner, which is what shipped.

The one thing worth deciding early: `async-states.tsx` is a single 87-line file behind ~30 call sites. Whatever the new dark/warm/gold direction does to loading and empty states, that file is the chokepoint — reskinning it changes every route at once, but making states *content-shaped* can't be done there, because the shape has to live per-route.