import { errorChainParts } from './error-fingerprint';
import { logThrowable, type ThrowableLogger } from './log-throwable';
import { toReportableError } from './reportable-error';
import { reportSwallowed } from './report-swallowed';
import { claimReportSlot } from './caught-failure-throttle';

export { CAUGHT_FAILURE_REPORT_INTERVAL_MS } from './caught-failure-throttle';

/** A site id is a fingerprint and a tag value, so it has to be one. */
const SITE = /^[a-z0-9]+(?:[-.:][a-z0-9]+)*$/;
const MAX_SITE = 120;

/** What a catch that does not rethrow reports. */
export type CaughtFailure = {
  /**
   * `error` for work that was dropped or left inconsistent; `warning` for a
   * per-row or best-effort step the caller recovers from.
   */
  level: 'error' | 'warning';
  /**
   * Stable, lowercase, hyphenated id of the catch (`poll-expiry-sweep-poll`).
   * It leads the Sentry fingerprint and the throttle key, and is the
   * `caught_at` tag, so a rename starts a new issue. A site shared by several
   * callers adds the caller with a `:` (`scheduled-sweep-candidate-read:invoice`).
   */
  site: string;
  /**
   * The log line, as the site always wrote it. It may interpolate ids, so it
   * goes to stdout only and never to Sentry.
   */
  message: string;
  /** The caught value, or omitted for a failure with nothing thrown. */
  error?: unknown;
  /**
   * Low-cardinality context (`sweep`, `provider`, `status`). Never member
   * content, ids, or free text: tags are indexed and not scrubbed as values.
   */
  tags?: Record<string, string>;
};

/**
 * The one way a catch that drops work, and does not rethrow, tells someone.
 *
 * Sentry's Nest integration does not capture console output, and the
 * exception filter only sees what propagates, so a catch that only logs is
 * invisible: the failure is in Render's logs and nowhere anyone is alerted
 * (#3379, #3364). This logs exactly as the site did, then reports through
 * {@link reportSwallowed}, which never throws, so reporting cannot change the
 * caller's outcome.
 *
 * Grouping is by site, then by what was caught (`kind[:code]` per error in
 * the cause chain), not by stack: the same catch failing the same way is one
 * issue wherever the throw came from, and a timeout and a missing column at
 * one site are two. The site's own message is not sent. The event carries
 * the caught error (scrubbed and normalized by `toReportableError`), or for a
 * failure with no error, the fixed text `caught failure: <site>`.
 *
 * `spec/behavior/observability.md` § Error Tracking states the rule; the
 * `caught-failure-coverage` spec enforces it.
 */
export function reportCaughtFailure(
  logger: ThrowableLogger,
  failure: CaughtFailure,
  now: number = Date.now(),
): void {
  const { level, site, message, error } = failure;
  const logLevel = level === 'error' ? 'error' : 'warn';
  if ('error' in failure) {
    logThrowable(logger, logLevel, message, error);
  } else {
    logger[logLevel](message);
  }

  if (!SITE.test(site) || site.length > MAX_SITE) {
    // A programming error, caught by the site's spec; never worth a throw.
    logger.warn(`reportCaughtFailure: invalid site id "${site}"`);
    return;
  }
  const fingerprint = ['caught-failure', site, ...caughtParts(failure)];
  // Throttled by the whole fingerprint, not the site: a timeout recurring at
  // a site must not hold back the first missing-column error there.
  if (!claimReportSlot(fingerprint.join('|'), now)) return;

  reportSwallowed(logger, `caught failure ${site}`, () => {
    const tags = { ...failure.tags, caught_at: site };
    if (!('error' in failure)) {
      return { message: `caught failure: ${site}`, level, tags, fingerprint };
    }
    return { error, level, tags, fingerprint };
  });
}

/** The cause chain's `kind[:code]` tokens; none when nothing was thrown. */
function caughtParts(failure: CaughtFailure): string[] {
  if (!('error' in failure)) return [];
  try {
    return errorChainParts(toReportableError(failure.error));
  } catch {
    // Grouping by site alone beats losing the report.
    return [];
  }
}
