/**
 * One report per key per interval, remembering at most `maxKeys` keys and
 * forgetting the oldest first. The query reporter and the signed-out auth
 * reporter both limit this way (`query-errors.ts`, `auth-failures.ts`), each
 * with its own interval and size.
 */
export function createKeyedRateLimiter(options: {
  readonly intervalMs: number;
  readonly maxKeys: number;
  readonly now: () => number;
}): (key: string) => boolean {
  const lastAllowedAt = new Map<string, number>();
  return (key) => {
    const at = options.now();
    const last = lastAllowedAt.get(key);
    if (last !== undefined && at - last < options.intervalMs) return false;
    // Recorded before the caller captures, so a capture that throws is not
    // retried on every attempt either. Deleted first so the newest is last in
    // the Map's order and the oldest is the one forgotten.
    lastAllowedAt.delete(key);
    lastAllowedAt.set(key, at);
    if (lastAllowedAt.size > options.maxKeys) {
      const oldest = lastAllowedAt.keys().next();
      if (!oldest.done) lastAllowedAt.delete(oldest.value);
    }
    return true;
  };
}
