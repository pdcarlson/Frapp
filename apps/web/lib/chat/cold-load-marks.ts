/**
 * `performance.mark`s for the cold-load milestones the framework board's
 * first-paint contract (`1s`) names and no generic RUM can know.
 *
 * ## Why marks, and which ones
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
 * A third, `composer-editor-ready`, is not a board clause. #2176 moved
 * `composer-focusable` off Tiptap and onto the server-rendered shell, which is
 * what the board's wording asks for — and that would have retired the only
 * number that can see the chat chunk getting slower. It is kept as its own
 * milestone so nothing is measured twice and nothing stops being measured.
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

/** The marks this module owns. Exported so a spec can name them without literals. */
export const COLD_LOAD_MARKS = {
  /** The active channel's first real message rows are on screen. */
  channelReadable: "frapp.chat.channel-readable",
  /**
   * The composer can take focus and take text.
   *
   * Since #2176 this is the **shell** — `ComposerShell`'s server-rendered
   * `<textarea>` — not Tiptap. The board's wording is "composer focusable", and
   * its 0ms set names "composer shell"; the shell is the thing that satisfies
   * both, and it does so without waiting on `GET /v1/channels`. Emitted through
   * `markComposerFocusable`, which explains the one wrinkle.
   */
  composerFocusable: "frapp.chat.composer-focusable",
  /**
   * Tiptap exists: rich text, mentions, slash commands, send.
   *
   * The number `composerFocusable` used to carry. Kept as its own milestone
   * rather than dropped, because it is the only signal that would catch the
   * chat chunk getting slower — the shell's number is nearly independent of it,
   * which is the point of the shell and would otherwise be a blind spot.
   */
  composerEditorReady: "frapp.chat.composer-editor-ready",
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
export function markColdLoad(
  mark: ColdLoadMark,
  options?: {
    /**
     * Milliseconds from the time origin to record instead of "now".
     *
     * For a milestone whose *moment* and whose *emission* are not the same
     * event — see `markComposerFocusable`, the only caller that passes it.
     */
    at?: number;
  },
): boolean {
  /*
    The server check comes BEFORE the dedupe set, and the order is the whole
    point rather than tidiness.

    `recorded` is module scope, and on the server a module is shared by every
    request the process handles — not per request, the way it is per document in
    a browser. So recording first and bailing second would let a single
    server-side call latch the mark permanently: that Node instance would then
    skip it for every member it served afterwards, and the metric would decay to
    nothing as instances aged. No call site can reach here on the server today
    (the timeline's is a `useEffect`, and both composer marks ride Tiptap's
    `onCreate` under `immediatelyRender: false`), which is exactly what would
    make the failure slow to notice.

    `performance` does exist on the server, so this is a check for the wrong
    *timeline* rather than for a missing API — a mark there measures against a
    process start that belongs to no page and that nothing reads.
  */
  if (typeof window === "undefined") return false;
  if (recorded.has(mark)) return false;

  try {
    const api = window.performance;
    if (!api?.mark || !api.measure) return false;

    // `mark()` returns the entry it created, whose `startTime` is milliseconds
    // from the time origin — navigation start on a cold load, which is the
    // interval every `1s` budget is stated against. Older browsers return
    // nothing; `now()` is the same clock and the same origin.
    //
    // `startTime` is User Timing Level 3 and is how a milestone that happened
    // earlier than its emission is recorded honestly rather than late.
    const entry =
      options?.at === undefined
        ? api.mark(mark)
        : api.mark(mark, { startTime: options.at });

    /*
      Read the timestamp back off the entry rather than trusting `options.at`,
      and the difference is not pedantry.

      A UA that predates the options bag does not throw on it — WebIDL says an
      unknown trailing argument is ignored — so it creates the mark at *now* and
      returns happily. Trusting `options.at` there would ship a mark at 1800ms
      and a `detail` claiming 350ms: two numbers in the same span that disagree,
      with the channel round trip back inside the one Sentry charts. Reading the
      entry makes the two agree in every case — precisely back-dated where the
      UA supports it, honestly late where it does not.
    */
    const msFromTimeOrigin = entry?.startTime ?? options?.at ?? api.now();

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
    /*
      Latched here — after the `mark` exists, before the `measure` is attempted.

      Both neighbours are wrong. Latching before the `try` (which is what this
      did) meant a `performance` disabled by privacy tooling consumed the
      milestone's once-per-document slot while emitting nothing, and no later
      call could retry; `composer-focusable` now comes from an `onCreate` that
      runs again on the next channel, so that retry is real. Latching after the
      `measure` is wrong the other way: an engine with the `mark` options bag
      but not the `measure` one (Safari 14.0 coerces the object and throws)
      would leave the name unlatched with a mark already on the timeline, and
      every channel switch would append another — ten duplicate spans on the
      pageload transaction, against this module's own once-per-page rule.

      The mark is the milestone. Once it is on the timeline the slot is spent.
    */
    recorded.add(mark);
    // The measure is what makes it legible as a duration, and is best-effort
    // for the same reason everything here is: it is not worth an exception.
    api.measure(mark, { start: 0, end: mark, detail: { msFromTimeOrigin } });
    return true;
  } catch {
    // A measurement is never worth an exception on the render path.
    return false;
  }
}

/**
 * When `ComposerShell` first became focusable, in ms from the time origin.
 *
 * `null` until the shell mounts; never reset, for the same per-document reason
 * `recorded` is not.
 */
let shellFocusableAt: number | null = null;

/**
 * Record — but do not yet emit — the moment the composer shell can take focus.
 *
 * Called from `ComposerShell`'s mount effect. It is the honest answer to the
 * budget: the shell is ordinary markup in the SSR payload, so the DOM node is
 * focusable from first paint, and this effect is the first moment client code
 * can observe that. (It is therefore an upper bound, and on a slow-hydrating
 * page a loose one — but it is bounded by hydration rather than by a network
 * round trip, which is the whole of what #2176 changed.)
 */
export function noteComposerShellFocusable(): void {
  if (typeof window === "undefined") return;
  if (shellFocusableAt !== null) return;
  try {
    shellFocusableAt = window.performance?.now?.() ?? null;
  } catch {
    // Same posture as `markColdLoad`: a measurement is never worth a throw.
  }
}

/**
 * Emit `composer-focusable`, back-dated to when the shell became focusable.
 *
 * Called from `Composer`'s `onCreate`, under the same `resolvedCanPost` guard
 * the mark has had since #2145 — and the split between *when it happened* and
 * *when it is emitted* is that guard's doing.
 *
 * The guard's reason survives the redefinition intact. A member who cannot post
 * in a channel gets no composer there at all: `Composer` returns an explanatory
 * paragraph, and the shell that preceded it is gone. Emitting at shell mount
 * would record "composer focusable" on loads that ended with no composer — and
 * because the mark is once-per-document, an alumnus (for whom ordinary channels
 * come back `can_post: false`) would then never record the real one in
 * `#alumni`. That is exactly the failure #2145 guarded against, and it is worse
 * now, not better, because the shell renders for everyone.
 *
 * So the guard stays where the answer is known, and the timestamp comes from
 * where the event happened. Reporting the emission time instead would put the
 * channel round trip back into the number, which is the thing #2176 removed.
 */
export function markComposerFocusable(): boolean {
  return markColdLoad(COLD_LOAD_MARKS.composerFocusable, {
    at: shellFocusableAt ?? undefined,
  });
}

/** Test seam. Nothing in the app resets these — a document gets one cold load. */
export function resetColdLoadMarksForTest(): void {
  recorded.clear();
  shellFocusableAt = null;
}
