/**
 * Turning an arbitrary throwable into something an operator can read.
 *
 * Nothing in JavaScript guarantees that a `throw` carries an `Error`, and in
 * this codebase the exceptions are not exotic — they are the norm on the data
 * path. A Supabase repository that destructures `{ data, error }` gets a PLAIN
 * OBJECT back, not a `PostgrestError`: postgrest-js only constructs that class
 * on the `.throwOnError()` path, and everywhere else `error` is `JSON.parse` of
 * the response body. Roughly two hundred repository methods here end in
 * `if (error) throw error`, so each of them throws `{ code, message, details,
 * hint }`.
 *
 * `String()` on one of those is the string `[object Object]`. That is what
 * `AllExceptionsFilter` used to send to Sentry and write to the 5xx log, and it
 * is how FRAPP-API-1 was recorded: a `PGRST205` — the API serving ahead of its
 * own migration, stated plainly in the object — reduced to a shrug in both
 * places at once.
 *
 * ## Why the message carries everything
 *
 * The message is the only channel that survives the reporting boundary.
 * `beforeSend` drops `extra` and every non-allowlisted context, and sweeps free
 * text through `redactFreeText` — so a message is both the part that arrives
 * and the part already covered for PII, and this module re-implements neither.
 *
 * ## Why `details` is left out, everywhere
 *
 * `code`, `message` and `hint` are templated prose: they name the fault and the
 * constraint, which is what triage needs. `details` is where Postgres puts the
 * offending ROW VALUES (`Key (email)=(a@b.com) already exists`), making it at
 * once the most sensitive of the four and the least necessary — the constraint
 * that failed is already named in `message`.
 *
 * `redactFreeText` would catch that email and pseudonymize a uuid, but it is
 * best-effort by its own docblock (a phone number goes straight through), and
 * the allowlist doctrine this sits under says not to lean on the weakest link
 * for a value that is optional. It is dropped for the internal log as well as
 * for Sentry: one function with one behavior is worth more than a marginally
 * richer log line, and the internal record already carries the request's raw
 * ids alongside it.
 */
export function toReportableError(exception: unknown): Error {
  if (exception instanceof Error) return exception;

  if (typeof exception === 'object' && exception !== null) {
    const record = exception as Record<string, unknown>;
    // `code` leads, because it is the stable half. PostgREST varies the prose
    // around a fault but not its code, and the message is what Sentry groups
    // on — leading with the code keeps one fault as one issue.
    const described = [
      text(record.code),
      text(record.message),
      text(record.hint),
    ].filter((part): part is string => part !== undefined);

    const error = new Error(
      described.length > 0 ? described.join(': ') : describeOpaque(record),
    );
    // Says, at a glance, that something threw a bare object: the message is now
    // accurate but the stack still points at the normalizer rather than at the
    // throw site, and this is what explains why.
    error.name = 'NonErrorThrowable';
    return error;
  }

  return new Error(String(exception));
}

/** A non-empty scalar field of a thrown object, or nothing. */
function text(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim().length > 0) return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

/**
 * Last resort for an object carrying none of the three fields above: serialize
 * it rather than let `[object Object]` back in.
 *
 * Capped, because an error object can drag a whole request payload behind it,
 * and guarded, because `JSON.stringify` throws on a circular reference or a
 * BigInt and returns `undefined` for a `toJSON` that does. Reporting an error
 * must never itself throw — that is the failure this whole module exists to
 * stop.
 */
function describeOpaque(record: Record<string, unknown>): string {
  try {
    return JSON.stringify(record).slice(0, 1000);
  } catch {
    return `[unserializable ${record.constructor?.name ?? 'object'}]`;
  }
}
