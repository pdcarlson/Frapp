import { describeThrownRecord } from '../observability/reportable-error';

/**
 * The `error` a PostgREST query resolves with, as it actually arrives.
 *
 * supabase-js types it as `PostgrestError`, a class extending `Error`. At
 * runtime it is a plain object: postgrest-js builds the class only on the
 * `.throwOnError()` path, which nothing here uses, and everywhere else `error`
 * is `JSON.parse` of the response body (`@supabase/postgrest-js` 2.x,
 * `dist/index.cjs`). Every field is optional here because a non-JSON error
 * body arrives as `{ message: body }` and nothing else.
 */
export interface PostgrestErrorRecord {
  code?: string | null;
  message?: string | null;
  hint?: string | null;
  details?: string | null;
}

/**
 * A failed Supabase query (table read or write, or RPC), thrown as a real
 * `Error` from the method that ran it (#1264).
 *
 * Throw it where the query's `{ error }` comes back:
 * `if (error) throw new SupabaseQueryError(error);`. Never throw the `error`
 * itself. That value is a plain object with no prototype and no stack, so
 * `String()` renders it `[object Object]`, every `error instanceof Error`
 * branch takes the wrong arm, and the 5xx `AllExceptionsFilter` reports has a
 * stack pointing at `toReportableError` rather than at the query that failed.
 * `supabase-query-error-throws.spec.ts` keeps that idiom from coming back.
 *
 * - **The message** is `code: message: hint`, built by the same
 *   `describeThrownRecord` `toReportableError` uses, so a log line, a Sentry
 *   title and the text a Discord import persists for its admin read exactly
 *   as they did when the normalizer built them.
 * - **`code` and `hint`** stay on as fields, so a caller that branches on the
 *   SQLSTATE (`isUniqueViolation`, `isForeignKeyViolation`) works on the
 *   caught error as it did on the raw object.
 * - **`details` is dropped.** Postgres fills it with the offending row values
 *   (`Key (email)=(a@b.com) already exists`), the constraint is already named
 *   in `message`, and an `Error` passed to Nest's logger or `util.inspect`
 *   prints its own fields. `reportable-error.ts` explains the same decision
 *   for Sentry and the logs; this is that decision at the source. A caller
 *   that needs `details` reads it off the raw `error` before wrapping it, the
 *   way `parseArchiveQuotaError` reads `message`.
 * - **The stack starts at the caller.** `captureStackTrace` drops this
 *   constructor's own frame, so the top frame is the method that threw, and
 *   Sentry's default grouping (keyed by `errorFingerprint` on `code` as well)
 *   tells one failing query from another.
 *
 * Storage-js and auth-js need none of this: they construct `StorageError` and
 * `AuthError`, both real `Error` subclasses, and those are thrown as they are.
 */
export class SupabaseQueryError extends Error {
  /** The SQLSTATE or PostgREST code (`23505`, `PGRST116`), when there is one. */
  declare readonly code?: string;
  /** PostgREST's hint, when there is one. It is also in `message`. */
  declare readonly hint?: string;

  constructor(error: PostgrestErrorRecord) {
    const { message, code, hint } = describeThrownRecord(
      error as Record<string, unknown>,
    );
    super(message);
    this.name = 'SupabaseQueryError';
    if (code !== undefined) this.code = code;
    if (hint !== undefined) this.hint = hint;
    // After `name` is set, so the stack's first line reads
    // `SupabaseQueryError: …`; `new.target` keeps this frame off the top.
    Error.captureStackTrace(this, new.target);
  }
}
