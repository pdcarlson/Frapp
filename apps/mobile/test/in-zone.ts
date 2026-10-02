/**
 * Runs `fn` with the process in the IANA `zone`, for a spec that has to pin a
 * zone CI doesn't run in (CI runs mobile in UTC and Asia/Tokyo, so UTC+13 and
 * +14, where a bare date most easily slips a day, are otherwise never seen).
 *
 * Node re-reads `TZ` when it is assigned, but only in the main thread of a
 * process: vitest's default `forks` pool is one, while a `threads` worker
 * ignores the assignment. So the switch is checked, and a spec that can't
 * actually change zone fails rather than passing in UTC.
 */
export function inZone<T>(zone: string, fn: () => T): T {
  /* eslint-disable turbo/no-undeclared-env-vars -- the zone under test, not a
     build input: no turbo task's output depends on it. */
  const previous = process.env.TZ;
  process.env.TZ = zone;
  try {
    // Compared through Intl on both sides: ICU canonicalizes some names
    // (Asia/Kolkata resolves as Asia/Calcutta).
    const active = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const asked = Intl.DateTimeFormat(undefined, {
      timeZone: zone,
    }).resolvedOptions().timeZone;
    if (active !== asked) {
      throw new Error(`inZone: asked for ${zone}, the process is in ${active}`);
    }
    return fn();
  } finally {
    // Assigning `undefined` would set the string "undefined", not unset it.
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
  /* eslint-enable turbo/no-undeclared-env-vars */
}
