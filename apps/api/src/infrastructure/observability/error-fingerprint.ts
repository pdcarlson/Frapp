/**
 * What tells two reported errors apart when their stacks cannot (#2131).
 *
 * Sentry groups an exception by its type and in-app stack, and stops reading
 * the message once the stack contributes. Two shapes this API reports defeat
 * that:
 *
 *  - A 5xx rethrown from a catch carries the provider error on `cause`, and
 *    `LinkedErrors` ships it as a second exception value. But a Stripe error's
 *    `name` is `Error` (the SDK sets only `type`), so a bad price and a
 *    timeout at one call site ship the same types over the same frames.
 *  - `toReportableError` builds its `NonErrorThrowable` inside itself, so
 *    every plain PostgREST object normalized at one site has the same stack,
 *    whatever its `code`.
 *
 * Either way, distinct faults collapse into one issue (FRAPP-API-4). The
 * fingerprint extends Sentry's own grouping (`{{ default }}`) with one
 * `kind[:code]` part per error in the chain, so each fault gets an issue and
 * one fault keeps one. Only identifier-shaped tokens are read, never a
 * message: free text belongs to the exception value, where the scrubber
 * sweeps it.
 */
const TOKEN = /^[A-Za-z0-9_.-]{1,64}$/;

/** A chain longer than this is pathological; the head is what distinguishes. */
const MAX_CHAIN = 4;

function token(value: unknown): string | undefined {
  if (typeof value === 'number') value = String(value);
  return typeof value === 'string' && TOKEN.test(value) ? value : undefined;
}

/** `name` unless it is the generic one, then the class, as Sentry would want it. */
function kindOf(error: Error): string {
  if (error.name !== 'Error') {
    const named = token(error.name);
    if (named) return named;
  }
  return token(error.constructor?.name) ?? 'Error';
}

function partOf(error: Error): string {
  const kind = kindOf(error);
  const code = token((error as { code?: unknown }).code);
  return code ? `${kind}:${code}` : kind;
}

/**
 * The fingerprint for a reported error, or `undefined` to leave Sentry's
 * default grouping alone.
 *
 * Only a chain (an error with an `Error` cause) or a normalized non-Error
 * gets one: a fingerprint re-keys the issue it lands in, and an ordinary
 * error's stack already tells it apart.
 */
export function errorFingerprint(reported: Error): string[] | undefined {
  const chain: Error[] = [];
  for (
    let current: unknown = reported;
    current instanceof Error && chain.length < MAX_CHAIN;
    current = current.cause
  ) {
    chain.push(current);
  }
  if (chain.length < 2 && reported.name !== 'NonErrorThrowable') {
    return undefined;
  }
  return ['{{ default }}', ...chain.map(partOf)];
}
