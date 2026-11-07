import { isTransientPostgresCode } from '#domain/constants/postgres-error-codes';

/**
 * Which import failures are worth another try (#1692).
 *
 * The sweep used to fail an import on any throw, so a PostgREST blip, a
 * connection reset or a Supabase restart ended an import that may have been
 * hours in, and only an admin starting it again could recover it. A failure
 * that clears on its own now leaves the job runnable instead, and the sweep
 * tries it again after a growing pause, up to {@link MAX_IMPORT_ATTEMPTS}.
 *
 * The test is an allowlist. An error it does not recognise stays terminal,
 * because retrying a fault that will not clear only delays the admin hearing
 * about it. Read by shape rather than by class, so the application layer does
 * not import the infrastructure's error types: a `SupabaseQueryError` carries
 * `code`, a Discord REST error and a Storage error carry an HTTP status, the
 * attachment copier's error says whether it is `retryable`, and Node's network
 * failures carry a `code` of their own, often on `cause`.
 */

/** Tries in one streak of failures, the first included, before the import stops. */
export const MAX_IMPORT_ATTEMPTS = 5;

/**
 * Failures in the job's current streak, read from its `attempt_count`.
 *
 * Before #1692 the claim bumped the column on every slice and nothing read
 * it, so a row from then can hold any count. A value above the cap cannot be
 * a streak, so it reads as none; one at or below it counts as it stands, and
 * the next clean slice zeroes it either way.
 */
export function importFailureStreak(attemptCount: number): number {
  return attemptCount > MAX_IMPORT_ATTEMPTS ? 0 : Math.max(attemptCount, 0);
}

/**
 * Whether a failed slice should pause and try again rather than fail the job:
 * the error clears on its own and the streak, this failure included, has not
 * used up {@link MAX_IMPORT_ATTEMPTS}.
 */
export function willRetryImport(error: unknown, attemptCount: number): boolean {
  return (
    isTransientImportFailure(error) &&
    importFailureStreak(attemptCount) + 1 < MAX_IMPORT_ATTEMPTS
  );
}

/**
 * How long the job waits after the `attempt`-th failure in a streak: 1, 2, 4,
 * then 8 minutes, about a quarter of an hour in all before the last try.
 * Measured from the moment the slice failed.
 */
export function importRetryDelayMs(attempt: number): number {
  const minutes = Math.min(2 ** Math.max(attempt - 1, 0), 15);
  return minutes * 60_000;
}

/**
 * PostgREST codes for a fault that clears on its own: no connection to the
 * database, an exhausted pool, or a schema cache still loading a migration
 * (`PGRST202` for a new function, `PGRST205` for a new table). Postgres's own
 * SQLSTATEs are in `postgres-error-codes.ts`.
 */
const TRANSIENT_POSTGREST_CODES = new Set([
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
  'PGRST202',
  'PGRST205',
]);

/** Node and undici codes for a connection that dropped or never formed. */
const TRANSIENT_NETWORK_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'EPIPE',
  'EAI_AGAIN',
  'UND_ERR_SOCKET',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

/** Errors that name a timeout or a network failure rather than a refusal. */
const TRANSIENT_NAMES = new Set(['AbortError', 'TimeoutError']);

/**
 * What postgrest-js writes, as `name: message`, when the fetch itself failed
 * and PostgREST never answered: undici's "fetch failed", or an abort or
 * timeout. It sends no code then, but a codeless error is not always this: a
 * non-JSON error body arrives as a bare message too, and that is no reason to
 * try again.
 */
const UNANSWERED_FETCH =
  /^(?:TypeError: fetch failed|AbortError:|TimeoutError:)/;

function httpStatusOf(record: Record<string, unknown>): number | null {
  for (const value of [record.status, record.statusCode]) {
    if (typeof value === 'number') return value;
    if (typeof value === 'string' && /^\d{3}$/.test(value)) {
      return Number(value);
    }
  }
  return null;
}

export function isTransientImportFailure(error: unknown, depth = 0): boolean {
  if (error === null || typeof error !== 'object' || depth > 3) return false;
  const record = error as Record<string, unknown>;

  const code = typeof record.code === 'string' ? record.code : undefined;
  if (code !== undefined && code !== '') {
    if (TRANSIENT_POSTGREST_CODES.has(code)) return true;
    if (isTransientPostgresCode(code)) return true;
    if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  }

  // The attachment copier has already decided, from the copy service's own
  // answer, whether another call can help.
  if (record.retryable === true) return true;

  const name = typeof record.name === 'string' ? record.name : '';
  const message = typeof record.message === 'string' ? record.message : '';
  if (TRANSIENT_NAMES.has(name)) return true;
  if (
    name === 'SupabaseQueryError' &&
    (code === undefined || code === '') &&
    UNANSWERED_FETCH.test(message) &&
    // The same "fetch failed" when the request's own headers were too big,
    // which no retry shrinks.
    !/headers exceeded/i.test(message)
  ) {
    return true;
  }
  // undici's own wording for a request that died on the wire.
  if (name === 'TypeError' && message === 'fetch failed') return true;

  const status = httpStatusOf(record);
  if (status !== null && (status === 408 || status === 429 || status >= 500)) {
    return true;
  }

  // storage-js keeps what it wrapped on `originalError`, not `cause`.
  return (
    isTransientImportFailure(record.cause, depth + 1) ||
    isTransientImportFailure(record.originalError, depth + 1)
  );
}
