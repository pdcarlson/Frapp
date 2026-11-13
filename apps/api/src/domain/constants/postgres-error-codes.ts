/**
 * Postgres `unique_violation` (SQLSTATE 23505), as surfaced by PostgREST on the
 * `code` field of a failed insert or update.
 *
 * Owned here rather than beside any one table's repository because the code is
 * a property of Postgres, not of a feature: a unique index on `chat_messages`
 * and one on `chapter_custom_fields` raise the same value, and a caller that
 * re-declares it locally is asserting the same fact twice. Every site that
 * needs the code imports it from this module.
 */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * Postgres `foreign_key_violation` (SQLSTATE 23503): an insert or update named
 * a parent row that does not exist, typically one deleted a moment earlier.
 */
export const PG_FOREIGN_KEY_VIOLATION = '23503';

/**
 * Postgres `check_violation` (SQLSTATE 23514): a check constraint, or a
 * function that raises it on purpose (`reorder_role_tiers` for a stale order).
 */
export const PG_CHECK_VIOLATION = '23514';

/**
 * `no_data_found`. Postgres raises it for a strict `select into` that matched
 * nothing; `assign_member_pledge_classes` raises it on purpose when a listed
 * member is not in the chapter (#3939).
 */
export const PG_NO_DATA_FOUND = 'P0002';

/** `invalid_parameter_value`: a function refused an argument it was given. */
export const PG_INVALID_PARAMETER_VALUE = '22023';

/**
 * Whether an unknown throwable is a Postgres unique violation.
 *
 * Use this where the caught value is untyped — a rejected repository promise,
 * or a `catch` binding. Where the error has already been narrowed to a shape
 * with a `code` field, compare against {@link PG_UNIQUE_VIOLATION} directly
 * rather than widening it back to `unknown` to call this.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === PG_UNIQUE_VIOLATION
  );
}

/**
 * Whether an unknown throwable is a Postgres foreign-key violation. The same
 * shape and the same guidance as {@link isUniqueViolation}.
 */
export function isForeignKeyViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === PG_FOREIGN_KEY_VIOLATION
  );
}

/**
 * SQLSTATEs for a fault that clears on its own, so a job may try the same
 * work again (#1692): a serialization failure (40001) or deadlock (40P01),
 * too many connections (53300), a statement cancelled by its timeout (57014),
 * and the server shutting down or still starting (57P01, 57P02, 57P03). Any
 * code in class 08, a connection exception, belongs here too; test it with
 * {@link isTransientPostgresCode} rather than this set alone.
 */
export const PG_TRANSIENT_CODES: ReadonlySet<string> = new Set([
  '40001',
  '40P01',
  '53300',
  '57014',
  '57P01',
  '57P02',
  '57P03',
]);

/** Whether a SQLSTATE names a fault that clears on its own. */
export function isTransientPostgresCode(code: string): boolean {
  return PG_TRANSIENT_CODES.has(code) || /^08[0-9A-Z]{3}$/.test(code);
}
