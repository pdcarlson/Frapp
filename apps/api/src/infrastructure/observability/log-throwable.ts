import { toReportableError } from './reportable-error';

/**
 * The Nest `Logger` methods we call. Kept structural so a test double does
 * not have to be a real `Logger`.
 */
export type ThrowableLogger = {
  error(message: unknown, ...optionalParams: unknown[]): unknown;
  warn(message: unknown, ...optionalParams: unknown[]): unknown;
};

/** Same predicate ConsoleLogger uses before treating a second string as stack. */
function isNestErrorStack(stack: string): boolean {
  return /^(.)+\n\s+at .+:\d+:\d+/.test(stack);
}

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
 * Interpolate into a string. Do not pass the throwable as a second argument
 * — that is the leak. A real `Error` may still pass `error.stack` as Nest's
 * stack slot on `error`, and only when the string matches Nest's stack
 * predicate (`at file:line:col`). Never do that on `warn`: ConsoleLogger
 * treats a trailing string as context, not a stack.
 */
export function logThrowable(
  logger: ThrowableLogger,
  level: 'error' | 'warn',
  message: string,
  error: unknown,
): void {
  const line = `${message}: ${toReportableError(error).message}`;
  if (
    level === 'error' &&
    error instanceof Error &&
    typeof error.stack === 'string' &&
    isNestErrorStack(error.stack)
  ) {
    logger.error(line, error.stack);
    return;
  }
  logger[level](line);
}
