# Performance budgets (web dashboard)

> Part of [Network resilience](README.md).

**Correction (2026-09-12, [#2145](https://github.com/pdcarlson/Frapp/issues/2145)):** every row of
the table below was rewritten. The previous version was written before the dashboard was built and
described a different application: it budgeted the initial JS at **< 200KB gzipped** measured with
the **Webpack analyzer**, named **`@tanstack/react-virtual`** for long lists and **Geist Sans** for
fonts, and stated that "each route is a dynamic import (`next/dynamic`)". None of that was true. The
app builds with **Turbopack** (Next 16, no analyzer installed), virtualizes with **`react-virtuoso`**,
sets **Figtree** through `next/font/local`, and contained **zero** uses of `next/dynamic` or
`React.lazy` until #2145 added the first three. The measured `/chat` entry bundle was **2.6x** the
budget it was said to be under, and nothing had ever reported the number. What follows is measured
rather than aspirational, and says how to re-measure it.

## First paint

The chat first-paint contract is owned by the framework board, section `1s`
([`spec/ui/web-greenfield/reference/`](../web-greenfield/reference/README.md)), which is rank 1 in
the trust order and beats this file where the two meet. Restated here only so this page is not
silently a second opinion:

| Milestone | Budget | Measurement |
|-----------|--------|-------------|
| Shell visible | ≤ 200ms | FCP — Sentry `browserTracingIntegration`, sampled |
| Cached channel readable | ≤ 400ms | `frapp.chat.channel-readable` (below) |
| Composer focusable | ≤ 400ms | `frapp.chat.composer-focusable` (below) |
| CLS above the composer | 0 | CLS — Sentry `browserTracingIntegration`, sampled |

`1s` also fixes the split those budgets assume: a **shell** chunk (layout, nav, top bar, find), a
**chat** chunk (timeline, composer, renderers) and a lazy **chat-extras** tier (emoji picker and
slash palette, both split; the mention list, deliberately not — see below; its Ask drawer and thread
panel no longer exist —
[#2142](https://github.com/pdcarlson/Frapp/issues/2142) deleted the thread panel, and Ask is a
top-bar dialog in the shell).

## Bundle size

Measured, not budgeted. `node scripts/measure-web-route-bundles.mjs` reads the emitted chunks after
`npm run build -w apps/web` and reports entry JS per route, raw and gzipped, splitting each route's
own cost from the shell floor every dashboard route pays. It is a **measurement, not a gate** — the
posture `npm run test:cov` has — and nothing in CI runs it. Freezing a number in a required check
is a decision about which routes get pinned at what, and this greenfield is mid-rebuild with several
lanes still moving the answer.

As of [#2175](https://github.com/pdcarlson/Frapp/issues/2175):

| | Entry JS | Gzipped |
|---|---|---|
| Shell floor (every dashboard route) | 909 KB | 247 KB |
| `/chat` | 1,733 KB | 501 KB |
| Next-largest route (`/settings`) | 1,045 KB | 285 KB |

The previous row, as of [#2145](https://github.com/pdcarlson/Frapp/issues/2145), was 898 KB / 242 KB
on the floor. #2175 put the segment error boundary and its surface on the shell path, which is where
those 11 KB went, and [`chapter-wizard-gate.tsx`](../../../apps/web/components/onboarding/chapter-wizard-gate.tsx)
carries the breakdown and the cheaper alternative that was measured and not taken. Both rows are kept
because the instruction below is to compare before and after, which needs a before.

The per-route totals move by less than the floor does (`/settings` +7 KB, `/chat` +9 KB against the
floor's +11 KB) even though each total contains the floor. That is not a transcription error: the two
rows are separate production builds and Turbopack re-chunks between them, so a module can move
between a route's own chunk and the shared floor. Compare rows to rows, not deltas to deltas, and
re-run the script rather than subtracting.

`/chat` carries ~824 KB of its own on top of the floor, nearly all of it one chunk holding
`@tiptap` + ProseMirror, `react-virtuoso`, and the `react-markdown` / `remark` / `micromark` chain.
That is the board's **chat** chunk and it is correctly eager: the timeline has to be readable and
the composer focusable inside 400ms, so neither can wait on a second request.

Re-measure before and after any change that touches an import on the shell or chat path. The numbers
are exact and reproducible from a build, which is why they are stated here at all — a target nobody
computes is the failure mode this page is a correction of.

## Cold-load instrumentation

Two milestones in the table above are application facts that no RUM can infer, so
[`apps/web/lib/chat/cold-load-marks.ts`](../../../apps/web/lib/chat/cold-load-marks.ts) emits them as
`performance.mark` + `performance.measure`, once per document. A third is not a board clause and is
there to keep a number the second one stopped carrying:

| Name | Timestamps | Emitted from | Means |
|------|-----------|--------------|-------|
| `frapp.chat.channel-readable` | itself | `message-timeline.tsx` | Real rows are committed to the DOM |
| `frapp.chat.composer-focusable` | `ComposerShell`'s mount | `composer.tsx` (`onCreate`) | The composer can take focus and take text |
| `frapp.chat.composer-editor-ready` | itself | `composer.tsx` (`onCreate`) | Tiptap exists: rich text, mentions, slash commands, send |

**`composer-focusable` means the shell, not the editor** ([#2176](https://github.com/pdcarlson/Frapp/issues/2176)).
It used to mean Tiptap, which made it unmeetable by construction: `<Composer>` is gated on
`activeChannel`, so the number was gated on `GET /v1/channels` and largely reported channel-list
latency. `1s` budgets "composer focusable" and puts "composer **shell**" in its 0ms set, and `1e`
pin 4 is more explicit still — "Composer live at first paint · typing is allowed before history
loads; the outbox queues it". The shell is what satisfies those, so it is what the mark reports.
Tiptap's timing is kept under its own name rather than dropped: the ~825 KB of its own that `/chat`
carries (measured below) is mostly that editor, and the shell's number is blind to it by design.

Three things the split makes true, none of them visible from the number alone:

- **It is emitted later than it happened.** The decision to emit belongs to `resolvedCanPost`, which
  is not known until the channel is, so `onCreate` emits and the entry is back-dated to the shell.
  Why that guard cannot move, and what the back-dating costs, is in `markComposerFocusable` in
  [`cold-load-marks.ts`](../../../apps/web/lib/chat/cold-load-marks.ts) — one home, and it is the
  file whose edit would falsify it.
- **It under-reports the worst loads.** If the channel list never resolves, nothing emits, even
  though the shell was focusable the whole time. The alternative is the false-success case above.
- **Not every sample is back-dated.** When no shell preceded the editor there is nothing to
  back-date to and the mark is stamped at emission — i.e. it carries Tiptap's construction time
  under the shell's name. That is a client-side navigation into `/chat` from another dashboard
  route, where the channel list may already be cached and `<Composer>` mounts with no loading state
  before it. So a rise in this number can mean the navigation mix changed rather than that the
  shell got slower; `composer-editor-ready` is what separates the two.

They need no reporting code. `@sentry/nextjs` is initialized with no `integrations` array, so the
SDK defaults apply and `browserTracingIntegration` turns `mark` and `measure` entries into spans on
the pageload transaction (`_addMeasureSpans` in `@sentry/browser-utils`). The same integration is
already the source of FCP, LCP, CLS, TTFB and INP — which is why this repo does **not** add a
`web-vitals` dependency or a second reporting path. Sampling is `tracesSampleRate` (0.1) and
initialization is skipped entirely without `NEXT_PUBLIC_SENTRY_DSN`, so these are field metrics: they
report nothing locally or in CI, by design.

**Locally**, they are visible in the Performance panel and readable directly:
`performance.getEntriesByName("frapp.chat.channel-readable", "measure")[0].duration` — each name
yields both a `mark` and a `measure`, and the second argument is what picks one.

That `duration` is the honest local number, because the measure is anchored at `start: 0`. The
Sentry *span* it becomes is not: it is short by `requestStart`, which is why the true interval also
travels as `detail.msFromTimeOrigin`. `cold-load-marks.ts` records that arithmetic.

## What is not measured, and why

- **Wall-clock cold load in CI.** The Playwright harness
  ([`apps/web/tests/visual/`](../../../apps/web/tests/visual/README.md)) boots `next dev` with no
  session, so it serves a development bundle and `/chat` renders "No chapter selected". Timings from
  it would measure neither a production bundle nor a populated route. A signed-in harness is scoped
  as its own piece of work in that README; until it exists, timing numbers come from the field
  (Sentry) or by hand.
- **A persisted read cache.** `1s`'s "first chunk" clause reads the channel list and the last ~30
  messages from Dexie. No such cache exists: Dexie holds only the outbound `drafts` and `outbox`
  tables, and TanStack Query is in-memory. So "cached channel readable" currently measures a network
  round trip, and the 400ms budget should be read against that until something changes. Since #2176
  this is true of "channel readable" **only**: the composer no longer waits on that round trip.

  Two different absent things are easy to conflate here, so: [`caching.md`](caching.md)'s 2026-09-10
  correction is about a `localStorage` `persistQueryClient` snapshot of the TanStack cache, and it
  says that layer never existed **and is not intended** — a 24h snapshot would restore
  `["user","me"]` and `["settings"]` after a sign-out or an account swap, which is a security
  argument, not a scheduling one. The board's Dexie read cache is a different design and that
  correction neither blesses nor rules it out. Whether the greenfield wants one is open, and this
  page does not decide it. ([#2097](https://github.com/pdcarlson/Frapp/issues/2097) is the
  `persistQueryClient` correction and is closed; the board's Dexie read cache has no issue of its
  own, which is why #2176's "Related: the persisted channel cache (#2097)" points at the wrong one.)
- **That the composer shell is in the SSR payload.** It is focusable before hydration only because
  `/chat` renders dynamically, and it renders dynamically only because
  `app/(dashboard)/layout.tsx` awaits `cookies()`. On a static prerender the `<Suspense>` boundary in
  `chat-page.tsx` would ship its fallback instead and nothing would fail, which is why this is listed
  as unmeasured rather than assumed. Checked 2026-09-14 (#2176) by fetching the route from a running
  production build — `npm run build -w apps/web && npm run start -w apps/web`, then `GET /chat` with
  a session cookie — and grepping the HTML: `<textarea` and `aria-label="Message composer"` present,
  `Loading chat` absent, 48,542 bytes. `chat-page.tsx` carries the same note at the boundary.

## Optimization techniques in use

- **Code splitting:** `next/dynamic` for the emoji picker, the slash palette and the onboarding
  wizard. Routes are split by the App Router; they are not hand-written dynamic imports.

  The board's `chat-extras` tier also names the **mention list**, which is deliberately *not* split:
  `mention-list.tsx` pulls only `ui/avatar` and erased Tiptap types, all of which are in the shell
  chunk already, so a dynamic boundary there buys indirection and no bytes — and
  `mention-suggestion.ts` constructs it synchronously inside Tiptap's `onStart`, which an async
  import would have to be contorted around. Stated rather than left implicit, because this page
  exists as a correction of claims nobody checked: if a heavy dependency is ever added to that
  component, it lands in the eager chat chunk and nothing will flag it.
- **Tree shaking:** per-component ShadCN imports; `lucide-react` ships per-icon ESM with
  `"sideEffects": false`, so no `modularizeImports` is needed. `@repo/chat-core` is consumed through
  its 11 subpath exports rather than a root barrel.
- **Image optimization:** `next/image`, WebP/AVIF.
- **Font optimization:** `next/font/local` for Figtree, self-hosted and metric-adjusted with
  `display: "swap"`.
- **Virtualization:** `react-virtuoso` for the message timeline.
