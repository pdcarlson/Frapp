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
