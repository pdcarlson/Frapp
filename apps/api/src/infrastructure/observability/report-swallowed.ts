import * as Sentry from '@sentry/nestjs';
import type { SeverityLevel } from '@sentry/nestjs';
import { errorFingerprint } from './error-fingerprint';
import { logThrowable, type ThrowableLogger } from './log-throwable';
import { toReportableError } from './reportable-error';

/** What {@link reportSwallowed} sends: a message, or a caught throwable. */
export type SwallowedReport = (
  | {
      /** Sent with `captureMessage`. */
      message: string;
      /**
       * Grouping for a message with no stack to group on. The error form
       * derives its own from {@link errorFingerprint}.
       */
      fingerprint?: string[];
    }
  | {
      /**
       * Sent with `captureException`, normalized through
       * {@link toReportableError} first, so a PostgREST plain object arrives
       * as its `code: message: hint` rather than `[object Object]`, and never
       * with `details`.
       */
      error: unknown;
    }
) & {
  level: SeverityLevel;
  tags: Record<string, string>;
  /**
   * Must already be a pseudonym (`pseudonymizeUserId`). The scrubber keeps
   * `event.user.id` only when it looks like one and drops anything else, so a
   * raw id is not leaked, but it is lost along with the grouping it carried.
   */
  user?: { id: string };
};

/**
 * Report something the caller deliberately does not let propagate — a
 * swallowed failure, a tripwire, a 5xx the exception filter turns into a
 * response — without letting the report change the caller's outcome.
 *
 * Sentry is a side channel. If a transport fault could escape it, an
 * unreachable Sentry would turn a correct webhook ack into a 5xx, a clean 401
 * into a 500, or a Discord connect redirect into an unhandled error, at exactly
 * the moment the reporting was meant to help. So nothing here throws: `build`
 * runs inside the guard as well (assembling tags hashes ids and reads request
 * state, and that is part of reporting), and a failure is logged with
 * {@link logThrowable} and dropped. Every caller already writes its own log
 * line for the event itself, so what is lost is the alert, never the record.
 *
 * One call, in the `captureMessage(message, context)` form, not `withScope`:
 * the SDK applies a `ScopeContext`'s level, tags, user and fingerprint to that
 * one event, which is all a scope fork was for. It is also the one shape a
 * reporting-policy change (a new tag every event should carry) has to reach.
 * Before this existed the same block was hand-rolled at seven sites, one of
 * which did not guard, so a Sentry throw there escaped a path whose whole
 * purpose was to swallow (#1739).
 *
 * @param subject Completes "Sentry report failed for …" in the failure log.
 * @returns The Sentry event id, or `undefined` when the report failed.
 */
export function reportSwallowed(
  logger: ThrowableLogger,
  subject: string,
  build: () => SwallowedReport,
): string | undefined {
  try {
    const report = build();
    const context = {
      level: report.level,
      tags: report.tags,
      ...(report.user ? { user: report.user } : {}),
    };
    if ('error' in report) {
      const reported = toReportableError(report.error);
      const fingerprint = errorFingerprint(reported);
      return Sentry.captureException(reported, {
        ...context,
        ...(fingerprint ? { fingerprint } : {}),
      });
    }
    return Sentry.captureMessage(report.message, {
      ...context,
      ...(report.fingerprint ? { fingerprint: report.fingerprint } : {}),
    });
  } catch (error) {
    logThrowable(logger, 'warn', `Sentry report failed for ${subject}`, error);
    return undefined;
  }
}
