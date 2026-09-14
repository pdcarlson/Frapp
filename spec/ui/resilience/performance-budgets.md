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

As of the first-chunk read cache (2026-09-14), measured on one tree with and without the change so
the two columns are comparable:

| | Entry JS — before | after | Gzipped — before | after |
|---|---|---|---|---|
| Shell floor (every dashboard route) | 910.1 KB | 910.6 KB | 247.2 KB | 247.5 KB |
| `/chat` | 1,736.8 KB | 1,741.3 KB | 502.3 KB | 503.9 KB |
| Next-largest route (`/settings`) | 1,045.7 KB | 1,046.2 KB | 285.7 KB | 286.0 KB |

As of the chapter-accent first-paint cache ([#2231](https://github.com/pdcarlson/Frapp/issues/2231)),
measured the same way on one tree either side of the change:

| | Entry JS — before | after | Gzipped — before | after |
|---|---|---|---|---|
| Shell floor (every dashboard route) | 910.6 KB | 912.5 KB | 247.5 KB | 248.2 KB |

**+0.7 KB gzipped on the floor, and the floor is where it lands** — `use-chapter-theme.ts` and
`frapp-client-provider.tsx` both reach the cache module, and both are on every dashboard route. That
is the cost of the change, and it is the number the storage decision turns on: the same cache built
on Dexie would have put the library itself on the floor instead, at **29.5 KB gzipped**
(`gzip -c node_modules/dexie/dist/modern/dexie.min.mjs | wc -c`) — fifty times the price, on twenty
routes, to serve one colour. So [`accent-cache.ts`](../../../apps/web/lib/theme/accent-cache.ts) is a
cookie with no imports at all, and the server half that does reach `next/headers` is never in a
client graph.

**The floor holding still is the point of that change's file layout, not an accident.** The wipe has
to be callable from `frapp-client-provider.tsx`, which every dashboard route loads, and the cache
module imports Dexie — which until then only `/chat` paid for. A static import would have moved
Dexie onto the floor for `/settings`, `/points` and everywhere else, to pay for a function that runs
at most twice a session. [`first-chunk-wipe.ts`](../../../apps/web/lib/chat/first-chunk-wipe.ts) is
therefore a dependency-free module spelled against the raw `indexedDB` API, and the cache module
takes the database name from it rather than the reverse. Verified after the build rather than assumed, and not by
`measure-web-route-bundles.mjs`, which reports sizes and chunk counts but never chunk contents:
grep the emitted `apps/web/.next/static/chunks/**/*.js` for `dexie` (one file matches), then read
`entryJSFiles` out of each `apps/web/.next/server/app/**/page_client-reference-manifest.js` and
check which routes list that chunk (only `/chat`). Nothing in CI does this.

Earlier rows, for the trend: as of [#2175](https://github.com/pdcarlson/Frapp/issues/2175) the floor
was 909 KB / 247 KB and `/chat` 1,733 KB / 501 KB; as of
[#2145](https://github.com/pdcarlson/Frapp/issues/2145) the floor was 898 KB / 242 KB. #2175 put the
segment error boundary and its surface on the shell path, which is where those 11 KB went, and
[`chapter-wizard-gate.tsx`](../../../apps/web/components/onboarding/chapter-wizard-gate.tsx) carries
the breakdown and the cheaper alternative that was measured and not taken. They are kept because the
instruction below is to compare before and after, which needs a before — but compare them only to
each other, not to the table above: those are different trees, and the 2026-09-14 pair is its own
before-and-after for exactly that reason.

Across those two historical rows the per-route totals moved by less than the floor did (`/settings`
+7 KB, `/chat` +9 KB against the floor's +11 KB) even though each total contains the floor. That is
not a transcription error: they are separate production builds and Turbopack re-chunks between them,
so a module can move between a route's own chunk and the shared floor. Compare rows to rows, not
deltas to deltas, and re-run the script rather than subtracting.

`/chat` carries ~830 KB of its own on top of the floor, nearly all of it one chunk holding
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
Tiptap's timing is kept under its own name rather than dropped: the ~830 KB of its own that `/chat`
carries ([Bundle size](#bundle-size), above) is mostly that editor, and the shell's number is blind
to it by design.

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

## Cached channel readable

**Correction (2026-09-14, later the same day, [#2243](https://github.com/pdcarlson/Frapp/issues/2243)):
every number in this section predates a change in what the mark measures, and the `1s` clause below
is no longer fully served.** `readable` in
[`message-timeline.tsx`](../../../apps/web/components/chat/message-timeline.tsx) now also requires a
resolved viewer id, so the mark waits on `GET /v1/users/me`. Two consequences, in the order they
matter:

- **The rank-1 clause is not met on the warm path.** `1s` asks for the cached rows to "render real;
  the rest of the window is skeleton with reserved geometry" — and until identity lands the *whole*
  window is now skeleton, so nothing renders real from the cache. That outranks the latency: § First
  paint puts `1s` at rank 1 in the trust order, above this file. It is a deliberate trade, not an
  oversight — the rows it withholds were painting the member's own messages as another member's, and
  §11 specs no third bubble shape to draw an unattributed row in — but it is a regression against
  the clause and is tracked as such, not as tuning.
- **The abort check below no longer means what it is cited for.** It aborted `**/v1/channels**` and
  saw the rows paint from Dexie — and it still passes, because that glob does not match
  `/v1/users/me`. But the rows now wait on that request too, so it no longer establishes that the
  cached timeline is readable without the network. Re-running it with identity blocked as well is
  part of #2249; until then this page does not have a network-independent-rows result, and must not
  be read as if it did.

Direction known, magnitude unmeasured: neither arm was re-run. The cold arm should not move —
[`use-user.ts`](../../../packages/hooks/src/use-user.ts)'s `["user","me"]` query has no `enabled`
gate and is issued on mount, while the messages fetch
([`use-chat-channel.ts`](../../../apps/web/lib/chat/use-chat-channel.ts)) is `enabled: !!channelId`
and cannot start until a channel id exists, so identity has strictly longer to land than the rows it
gates. The warm arm is the one at risk. **Re-measuring it does not need anything that does not
exist**: the by-hand procedure below produced these numbers with Playwright driving a signed-in
session, and what § What is not measured, and why records as missing is a signed-in harness in *CI*,
not a signed-in session. [#2249](https://github.com/pdcarlson/Frapp/issues/2249) tracks re-measuring
and restoring a local-first warm paint, and carries the options with what each costs.

`1s`'s "first chunk" clause — the channel list and the last ~30 messages read from Dexie — is built
as of 2026-09-14, subject to the correction above. Until then this page recorded it as absent and
said "cached channel readable" therefore measured a network round trip, which it did.

**One half of the clause is served differently from how it is worded, and the difference is
visible in a miss.** `1s` says "channel list + **last active channel id** from cache"; the shell's
channel selection is unchanged, and the cache instead keeps the tails of the three most recently
read channels plus — pinned against eviction — the channel a cold load actually lands on
([`default-channel.ts`](../../../apps/web/lib/chat/default-channel.ts), which `chat-shell.tsx` and
the cache's eviction now both read, because they disagreed and the disagreement evicted exactly the
tail the next reload asked for). Persisting a *selection* would change which channel a reload lands
on, which is a UX decision rather than a caching one. The consequence to keep in mind when reading
the numbers below: a member whose landing channel is outside those four pays the cold number, not
the warm one.

[`apps/web/lib/chat/first-chunk-cache.ts`](../../../apps/web/lib/chat/first-chunk-cache.ts) holds it
in an IndexedDB database of its own, keyed by Supabase auth uid + chapter id; the layer, its wipe
rules and why it is not the `persistQueryClient` snapshot [`caching.md`](caching.md) rules out are
owned there and in that file. What belongs here is the number.

Measured by hand on 2026-09-14 against a production build (`npm run build -w apps/web && npm run
start -w apps/web`) with the local API and Supabase up, a seeded chapter of 8 channels and 50
messages, and Playwright driving a real signed-in session. Both arms are the **same build, browser
and dataset**; the only difference is whether the cache held rows at document load. Five paired
runs, reading
`performance.getEntriesByName("frapp.chat.channel-readable", "measure")[0].duration`:

| | median | range (5 runs) |
|---|---|---|
| Cold cache | 1,179 ms | 1,027–1,551 |
| Warm cache | **323 ms** | 283–335 |

**The cold arm is the new build with an empty cache, not the old build.** It is the right control
for what the cache buys — same code, same data, one variable — but it is not a before-and-after
against `main`, and it cannot answer whether the cold path itself regressed. The changed build does
strictly more work on a cold load than the old one did: it opens a second IndexedDB database, reads
it, prunes it, and mounts one more `["channels"]` observer and two more `useAuthUserId`
subscriptions. That cost is not isolated by this measurement.

`frapp.chat.composer-focusable` was 186 ms cold and 207 ms warm — the same number inside the run-to-run
spread, which is the #2176 shell doing its job: it never waited on the channel list, so a cache for
the channel list cannot move it either way.

Three qualifications, because a number without them is worth less than none — and a fourth,
larger than all of them, in the correction at the top of this section:

- **This is a sandbox VM on localhost, not a device on a network.** It is a controlled A/B of one
  variable, not a field measurement. The 400ms budget is a field budget and Sentry
  (`tracesSampleRate` 0.1) remains the only thing that can report against it.
- **Five runs is five runs.** Every warm sample here cleared 400 ms (283–335), but a handful of
  loads on one idle machine is not a distribution, and an earlier revision of this same measurement
  had a warm sample at 417 ms. Treat the budget as met at the median on this hardware, not as met
  everywhere.
- **The mark fires just before `react-virtuoso` commits its rows**, so it reports when the timeline
  stopped being a placeholder rather than when pixels landed. That is a property of the existing
  instrument, unchanged here, and it applies equally to both arms.

That the warm paint comes from the cache rather than from a fast network was checked separately by
aborting every `**/v1/channels**` request in the page and reloading: the rail and the timeline still
rendered, from Dexie alone.

**Two issue numbers that are easy to conflate, kept because the corpus has nowhere else to record
it.** [#2097](https://github.com/pdcarlson/Frapp/issues/2097) is the `persistQueryClient`
correction — closed, and about a `localStorage` snapshot of the whole TanStack cache that never
existed and is not intended. This cache is a different design and [`caching.md`](caching.md) argues
the distinction. #2176's body carries "Related: the persisted channel cache (#2097)", which points
at that correction rather than at this work; the board's Dexie read cache never had an issue of its
own, which is how the two came to be linked.

## What is not measured, and why

- **Wall-clock cold load in CI.** The Playwright harness
  ([`apps/web/tests/visual/`](../../../apps/web/tests/visual/README.md)) boots `next dev` with no
  session, so it serves a development bundle and `/chat` renders "No chapter selected". Timings from
  it would measure neither a production bundle nor a populated route. A signed-in harness is scoped
  as its own piece of work in that README; until it exists, timing numbers come from the field
  (Sentry) or by hand.
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
