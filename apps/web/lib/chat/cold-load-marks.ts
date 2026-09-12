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
 * The `measure` is what carries the number: a bare mark records a timestamp, and
 * the budget is a duration from navigation start. `measure` with no `start` runs
 * from the time origin, which for a cold load is exactly the interval `1s`
 * budgets.
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
  if (recorded.has(mark)) return false;
  recorded.add(mark);

  // Guarded rather than feature-detected once at module scope: `performance`
  // exists on the server too, where `mark` would record against a timeline that
  // belongs to no page and is never read.
  if (typeof window === "undefined") return false;

  try {
    const api = window.performance;
    if (!api?.mark || !api.measure) return false;
    api.mark(mark);
    // No `start`, so the browser measures from the time origin — navigation
    // start on a cold load, which is what the budget is stated against.
    api.measure(mark, { start: 0, end: mark });
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
