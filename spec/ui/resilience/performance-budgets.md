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
**chat** chunk (timeline, composer, renderers) and a lazy **chat-extras** tier (emoji picker, slash
palette, mention list; its Ask drawer and thread panel no longer exist —
[#2142](https://github.com/pdcarlson/Frapp/issues/2142) deleted the thread panel, and Ask is a
top-bar dialog in the shell).

## Bundle size

Measured, not budgeted. `node scripts/measure-web-route-bundles.mjs` reads the emitted chunks after
`npm run build -w apps/web` and reports entry JS per route, raw and gzipped, splitting each route's
own cost from the shell floor every dashboard route pays. It is a **measurement, not a gate** — the
posture `npm run test:cov` has — and nothing in CI runs it. Freezing a number in a required check
is a decision about which routes get pinned at what, and this greenfield is mid-rebuild with several
lanes still moving the answer.

As of #2145, on `main`:

| | Entry JS | Gzipped |
|---|---|---|
| Shell floor (every dashboard route) | 898 KB | 242 KB |
| `/chat` | 1,724 KB | 497 KB |
| Next-largest route (`/settings`) | 1,038 KB | 282 KB |

`/chat` carries ~826 KB of its own on top of the floor, nearly all of it one chunk holding
`@tiptap` + ProseMirror, `react-virtuoso`, and the `react-markdown` / `remark` / `micromark` chain.
That is the board's **chat** chunk and it is correctly eager: the timeline has to be readable and
the composer focusable inside 400ms, so neither can wait on a second request.

Re-measure before and after any change that touches an import on the shell or chat path. The numbers
are exact and reproducible from a build, which is why they are stated here at all — a target nobody
computes is the failure mode this page is a correction of.

## Cold-load instrumentation

Two milestones in the table above are application facts that no RUM can infer, so
[`apps/web/lib/chat/cold-load-marks.ts`](../../../apps/web/lib/chat/cold-load-marks.ts) emits them as
`performance.mark` + `performance.measure`, once per document:

| Name | Emitted from | Means |
|------|--------------|-------|
| `frapp.chat.channel-readable` | `message-timeline.tsx` | Real rows are committed to the DOM |
| `frapp.chat.composer-focusable` | `composer.tsx` (`onCreate`) | The editor exists and can take focus |

They need no reporting code. `@sentry/nextjs` is initialized with no `integrations` array, so the
SDK defaults apply and `browserTracingIntegration` turns `mark` and `measure` entries into spans on
the pageload transaction (`_addMeasureSpans` in `@sentry/browser-utils`). The same integration is
already the source of FCP, LCP, CLS, TTFB and INP — which is why this repo does **not** add a
`web-vitals` dependency or a second reporting path. Sampling is `tracesSampleRate` (0.1) and
initialization is skipped entirely without `NEXT_PUBLIC_SENTRY_DSN`, so these are field metrics: they
report nothing locally or in CI, by design.

**Locally**, they are visible in the Performance panel and readable directly:
`performance.getEntriesByName("frapp.chat.channel-readable", "measure")[0].duration`.

## What is not measured, and why

- **Wall-clock cold load in CI.** The Playwright harness
  ([`apps/web/tests/visual/`](../../../apps/web/tests/visual/README.md)) boots `next dev` with no
  session, so it serves a development bundle and `/chat` renders "No chapter selected". Timings from
  it would measure neither a production bundle nor a populated route. A signed-in harness is scoped
  as its own piece of work in that README; until it exists, timing numbers come from the field
  (Sentry) or by hand.
- **A persisted read cache.** `1s`'s "first chunk" clause reads the channel list and the last ~30
  messages from Dexie. No such cache exists: Dexie holds only the outbound `drafts` and `outbox`
  tables, and TanStack Query is in-memory. See [`caching.md`](caching.md) — its 2026-09-10 correction
  records that the persisted layer was specified, never built, and is tracked by
  [#2097](https://github.com/pdcarlson/Frapp/issues/2097). Until it lands, "cached channel readable"
  measures a network round trip.

## Optimization techniques in use

- **Code splitting:** `next/dynamic` for the chat-extras tier and the onboarding wizard. Routes are
  split by the App Router; they are not hand-written dynamic imports.
- **Tree shaking:** per-component ShadCN imports; `lucide-react` ships per-icon ESM with
  `"sideEffects": false`, so no `modularizeImports` is needed. `@repo/chat-core` is consumed through
  its 11 subpath exports rather than a root barrel.
- **Image optimization:** `next/image`, WebP/AVIF.
- **Font optimization:** `next/font/local` for Figtree, self-hosted and metric-adjusted with
  `display: "swap"`.
- **Virtualization:** `react-virtuoso` for the message timeline.
