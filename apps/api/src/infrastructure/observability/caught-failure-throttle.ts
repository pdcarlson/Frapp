/**
 * How often one `reportCaughtFailure` site may reach Sentry. A failure that
 * drops work tends to repeat: a database outage fails every sweep tick and
 * every row in it, and one event per site per window says as much as a
 * thousand. The log line is never throttled, so the record is complete; only
 * the alert is.
 *
 * Its own module, with no imports, so the API's jest setup can reset it
 * without loading Sentry ahead of a spec's `jest.mock('@sentry/nestjs')`.
 */
export const CAUGHT_FAILURE_REPORT_INTERVAL_MS = 10 * 60 * 1000;

const lastReportedAt = new Map<string, number>();

/** True, and the window starts, when `site` has not reported within it. */
export function claimReportSlot(site: string, now: number): boolean {
  const last = lastReportedAt.get(site);
  if (last !== undefined && now - last < CAUGHT_FAILURE_REPORT_INTERVAL_MS) {
    return false;
  }
  lastReportedAt.set(site, now);
  return true;
}

/**
 * Forget every site's last report. Run after each spec by the API's jest
 * setup, so one spec's report cannot throttle the next one's.
 */
export function resetCaughtFailureThrottle(): void {
  lastReportedAt.clear();
}
