import { useEffect, useState } from "react";

/**
 * A `Date` that re-renders its caller every `intervalMs` (default 60s).
 *
 * For screens that bucket rows by "now" (today/earlier splits, relative
 * timestamps) on a tab that never unmounts: React Query's structural sharing
 * keeps `data` referentially stable across a refetch that returns identical
 * rows, so a `new Date()` read once at mount (or inside a memo with no time
 * dependency) would freeze the bucketing at whatever moment the screen first
 * rendered.
 */
export function useNowTick(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return now;
}
