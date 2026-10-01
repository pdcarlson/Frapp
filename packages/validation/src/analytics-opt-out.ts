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
 *   flag. A read that hasn't answered is not "missing": web counts that
 *   chapter as opted out without asking this predicate (#2957); mobile
 *   doesn't yet (#3101). See `spec/behavior/data-retention.md`
 *   #analytics-events-pseudonymous.
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
