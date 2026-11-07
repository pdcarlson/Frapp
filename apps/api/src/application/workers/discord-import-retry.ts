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
 * `code`, a Discord REST error and a Storage error carry an HTTP status, and
 * Node's network failures carry a `code` of their own, often on `cause`.
 */

/** Tries in one streak of failures, the first included, before the import stops. */
export const MAX_IMPORT_ATTEMPTS = 5;

/**
 * How long the job waits after the `attempt`-th failure in a streak: 1, 2, 4,
 * then 8 minutes, about a quarter of an hour in all before the last try.
 * Measured from the start of the failed tick.
 */
export function importRetryDelayMs(attempt: number): number {
  const minutes = Math.min(2 ** Math.max(attempt - 1, 0), 15);
  return minutes * 60_000;
}

/**
 * PostgREST and Postgres codes for a fault that clears on its own: no
 * connection, an exhausted pool, a schema cache still loading a migration
 * (`PGRST202` for a new function, `PGRST205` for a new table), a serialization
 * failure or deadlock, a statement cut off, the server restarting.
 */
const TRANSIENT_DB_CODES = new Set([
  'PGRST000',
  'PGRST001',
  'PGRST002',
  'PGRST003',
  'PGRST202',
  'PGRST205',
  '40001',
  '40P01',
  '53300',
  '57014',
  '57P01',
  '57P02',
  '57P03',
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
const TRANSIENT_NAMES = new Set([
  'AbortError',
  'TimeoutError',
  // storage-js wraps a fetch that never got an answer in this.
  'StorageUnknownError',
]);

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
    if (TRANSIENT_DB_CODES.has(code) || code.startsWith('08')) return true;
    if (TRANSIENT_NETWORK_CODES.has(code)) return true;
  }

  const name = typeof record.name === 'string' ? record.name : '';
  if (TRANSIENT_NAMES.has(name)) return true;
  // supabase-js answers a fetch that never reached PostgREST with no code;
  // PostgREST itself always sends one.
  if (name === 'SupabaseQueryError' && (code === undefined || code === '')) {
    return true;
  }
  // undici's own wording for a request that died on the wire.
  if (name === 'TypeError' && record.message === 'fetch failed') return true;

  const status = httpStatusOf(record);
  if (status !== null && (status === 408 || status === 429 || status >= 500)) {
    return true;
  }

  return isTransientImportFailure(record.cause, depth + 1);
}
