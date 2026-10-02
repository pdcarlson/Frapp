/**
 * Fourth client-side gate, alongside `can`, `isModuleEnabled`, and
 * `subscriptionWriteState`.
 *
 * Mirrors the API's per-chapter analytics opt-out
 * (`chapters.analytics_opt_out`, `AnalyticsService`). **Shared,
 * deliberately** — web already suppressed events at the SDK boundary;
 * mobile posted through the same endpoint with no client check, so an
 * opted-out chapter still emitted until the server dropped the event.
 *
 * Two properties this file deliberately keeps:
 *
 * - **Fail-open on the flag.** Only an explicit `true` suppresses events.
 *   Missing / `undefined` / `false` means analytics is on (the product
 *   default; onboarding discloses this). This reads a *loaded* chapter's
 *   flag. A read that hasn't answered is not "missing": that case is
 *   {@link isChapterAnalyticsOptedOut}'s.
 * - **Never a security boundary.** The API repeats the check before any
 *   server-originated event is sent (`spec/behavior/data-retention.md`
 *   #analytics-events-pseudonymous). This exists so an opted-out chapter
 *   does not emit events the server would drop.
 */

export function isAnalyticsOptedOut(
  analyticsOptOut: boolean | null | undefined,
): boolean {
  return analyticsOptOut === true;
}

/**
 * The gate a client applies to its active chapter, given the chapter read's
 * payload (`GET /v1/chapters/current`, the member view every member can read).
 *
 * `undefined` or `null` means that read hasn't answered: it is pending, it
 * failed with nothing cached, or there is no active chapter. That counts as
 * **opted out**, because nothing on the server stands behind what the PostHog
 * SDK sends directly, so opting in is the step that needs proof (#2957). Once a
 * payload has loaded, {@link isAnalyticsOptedOut} decides.
 *
 * Both clients' `AnalyticsProvider` apply it (mobile since #3101). Rule:
 * `spec/behavior/data-retention.md` #analytics-events-pseudonymous.
 */
export function isChapterAnalyticsOptedOut(
  chapter: { analytics_opt_out?: boolean | null } | null | undefined,
): boolean {
  return chapter == null || isAnalyticsOptedOut(chapter.analytics_opt_out);
}
