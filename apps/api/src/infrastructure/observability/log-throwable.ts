import { toReportableError } from './reportable-error';

/**
 * The Nest `Logger` methods we call. Kept structural so a test double does
 * not have to be a real `Logger`.
 */
export type ThrowableLogger = {
  error(message: unknown, ...optionalParams: unknown[]): unknown;
  warn(message: unknown, ...optionalParams: unknown[]): unknown;
};

/**
 * Log a throwable without handing Nest's ConsoleLogger the object.
 *
 * `logger.error(message, error)` with a PostgREST `{ code, message, details,
 * hint }` body is not "message plus stack". Nest treats a non-stack second
 * argument as another message and `util.inspect`s it, which prints `details`
 * — the field Postgres fills with row values (`Key (email)=(a@b.com) is not
 * present in table "users"`). `toReportableError` already drops that field for
 * Sentry; this is the same decision on the plaintext log path
 * (`spec/behavior/observability.md` § Error Tracking, #1669).
 *
 * Always interpolate into a **single** string. Do not pass the throwable as a
 * second argument — that is the leak.
 */
export function logThrowable(
  logger: ThrowableLogger,
  level: 'error' | 'warn',
  message: string,
  error: unknown,
): void {
  logger[level](`${message}: ${toReportableError(error).message}`);
}
