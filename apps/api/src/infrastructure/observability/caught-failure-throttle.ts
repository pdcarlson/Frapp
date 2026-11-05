/**
 * How often one `reportCaughtFailure` fingerprint (a site, plus what was
 * caught there) may reach Sentry. A failure that
 * drops work tends to repeat: a database outage fails every sweep tick and
 * every row in it, and one event per fault per window says as much as a
 * thousand. The log line is never throttled, so the record is complete; only
 * the alert is.
 *
 * Its own module, with no imports, so the API's jest setup can reset it
 * without loading Sentry ahead of a spec's `jest.mock('@sentry/nestjs')`.
 */
export const CAUGHT_FAILURE_REPORT_INTERVAL_MS = 10 * 60 * 1000;

const lastReportedAt = new Map<string, number>();

/**
 * True, and the window starts, when `key` has not reported within it. Keys
 * are code-defined site ids and identifier-shaped error tokens, so the map
 * stays small.
 */
export function claimReportSlot(key: string, now: number): boolean {
  const last = lastReportedAt.get(key);
  if (last !== undefined && now - last < CAUGHT_FAILURE_REPORT_INTERVAL_MS) {
    return false;
  }
  lastReportedAt.set(key, now);
  return true;
}

/**
 * Forget every key's last report. Run after each spec by the API's jest
 * setup, so one spec's report cannot throttle the next one's.
 */
export function resetCaughtFailureThrottle(): void {
  lastReportedAt.clear();
}
