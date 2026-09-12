/**
 * `performance.mark`s for the two cold-load milestones the framework board's
 * first-paint contract (`1s`) names and no generic RUM can know.
 *
 * ## Why marks, and why only two
 *
 * `1s` budgets four things: shell visible ≤ 200ms, cached channel readable
 * ≤ 400ms, composer focusable ≤ 400ms, and zero CLS above the composer. Two of
 * those are already measured and two were not:
 *
 * - **Shell visible** is FCP, and **CLS** is CLS. Sentry collects both already.
 *   `@sentry/nextjs` passes no `integrations` array (`lib/sentry/options.ts`),
 *   so the SDK defaults apply and `browserTracingIntegration` attaches
 *   LCP/CLS/FCP/TTFB/INP to the pageload transaction. Adding a second web-vitals
 *   pipeline would be two sources of one number, and the second one would be the
 *   one nobody checks.
 * - **Channel readable** and **composer focusable** are application milestones.
 *   No RUM knows when a message list stopped being a placeholder, so these are
 *   the two that had to be emitted from the code that knows.
 *
 * ## Where they go
 *
 * Nowhere new. The same Sentry integration turns `mark` and `measure` entries
 * into spans on the pageload transaction — `_addMeasureSpans` in
 * `@sentry/browser-utils`, which switches on `entryType` `"mark"`, `"paint"` and
 * `"measure"` alike. So a mark here is a span in Sentry on the sampled share of
 * pageloads, a row in the Performance panel for anyone with devtools open, and a
 * `performance.getEntriesByName` lookup for a future harness — with no reporting
 * code, no new event schema, and nothing to keep in sync.
 *
 * The `measure` is what makes the milestone legible as a duration rather than a
 * timestamp — but read the note at the `measure` call before trusting the number
 * Sentry shows: the span it becomes is offset by `requestStart`, and the
 * authoritative value rides along in `detail` instead.
 *
 * ## Rules these follow
 *
 * **Once per page, first occurrence only.** These are *cold-load* budgets. A
 * channel switch ten minutes in also makes a timeline readable, and recording
 * that would turn the metric into an average of warm interactions and drag it
 * to a number that flatters the cold load it exists to measure. The dedupe is
 * per-name and per-document; a client-side route change back to `/chat` does not
 * re-arm it, which is correct — that is not a cold load either.
 *
 * **Never throws.** The API is missing in older Safari and can be disabled
 * outright by privacy tooling, and a placeholder measurement is not worth a
 * blank screen. Every call is guarded and every failure is swallowed.
 */

/** The mark this module owns. Exported so a spec can name them without literals. */
export const COLD_LOAD_MARKS = {
  /** The active channel's first real message rows are on screen. */
  channelReadable: "frapp.chat.channel-readable",
  /** The composer's editor is mounted and can take focus. */
  composerFocusable: "frapp.chat.composer-focusable",
} as const;

export type ColdLoadMark =
  (typeof COLD_LOAD_MARKS)[keyof typeof COLD_LOAD_MARKS];

const recorded = new Set<string>();

/**
 * Record a cold-load milestone, at most once per document.
 *
 * Returns whether it recorded, which is not decoration: the dedupe is the whole
 * behaviour, and a spec that could not see it would be asserting that the
 * function was called rather than that the metric means what it claims.
 */
export function markColdLoad(mark: ColdLoadMark): boolean {
  /*
    The server check comes BEFORE the dedupe set, and the order is the whole
    point rather than tidiness.

    `recorded` is module scope, and on the server a module is shared by every
    request the process handles — not per request, the way it is per document in
    a browser. So recording first and bailing second would let a single
    server-side call latch the mark permanently: that Node instance would then
    skip it for every member it served afterwards, and the metric would decay to
    nothing as instances aged. Neither call site can reach here on the server
    today (one is a `useEffect`, the other Tiptap's `onCreate` under
    `immediatelyRender: false`), which is exactly what would make the failure
    slow to notice.

    `performance` does exist on the server, so this is a check for the wrong
    *timeline* rather than for a missing API — a mark there measures against a
    process start that belongs to no page and that nothing reads.
  */
  if (typeof window === "undefined") return false;
  if (recorded.has(mark)) return false;
  recorded.add(mark);

  try {
    const api = window.performance;
    if (!api?.mark || !api.measure) return false;

    // `mark()` returns the entry it created, whose `startTime` is milliseconds
    // from the time origin — navigation start on a cold load, which is the
    // interval every `1s` budget is stated against. Older browsers return
    // nothing; `now()` is the same clock and the same origin.
    const entry = api.mark(mark);
    const msFromTimeOrigin = entry?.startTime ?? api.now();

    /*
      `detail` is not decoration, and this is the subtle part of the file.

      The obvious reading of the `measure` below is that Sentry receives the
      from-origin interval. It does not. `_addMeasureSpans` in
      `@sentry/browser-utils` starts the span at
      `timeOrigin + Math.max(startTime, requestStart)` and ends it at
      `timeOrigin + startTime + duration`, so for a measure anchored at 0 the
      span's duration comes out as `duration - requestStart` — short by however
      long redirect, DNS, TCP and TLS took, which on a real cold load is
      routinely 100-400ms. The SDK is not hiding it (it stamps
      `sentry.browser.measure_happened_before_request` on such a span), but the
      error is systematically in the flattering direction and grows with how bad
      the connection was. A budget that looks better the slower the network is
      the one kind of wrong this file must not be.

      So the authoritative number travels as `detail`, which
      `_addDetailToSpanAttributes` copies onto the span verbatim: read
      `sentry.browser.measure.detail.msFromTimeOrigin`, not the span duration.
      Locally the `measure` entry's own `duration` is already correct, and that
      is what devtools and `getEntriesByName` show.
    */
    api.measure(mark, { start: 0, end: mark, detail: { msFromTimeOrigin } });
    return true;
  } catch {
    // A measurement is never worth an exception on the render path.
    return false;
  }
}

/** Test seam. Nothing in the app resets these — a document gets one cold load. */
export function resetColdLoadMarksForTest(): void {
  recorded.clear();
}
