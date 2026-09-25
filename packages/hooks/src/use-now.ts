"use client";

import { useMemo, useSyncExternalStore } from "react";

/** 30s matches the previous EventCard check-in window ticker. */
const TICK_MS = 30_000;

let currentNow = Date.now();
const listeners = new Set<() => void>();
let interval: ReturnType<typeof setInterval> | null = null;

function emit(): void {
  currentNow = Date.now();
  for (const listener of listeners) listener();
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  if (interval === null) {
    currentNow = Date.now();
    interval = setInterval(emit, TICK_MS);
  }
  return () => {
    listeners.delete(onStoreChange);
    if (listeners.size === 0 && interval !== null) {
      clearInterval(interval);
      interval = null;
    }
  };
}

/**
 * With nothing subscribed the interval is stopped, so `currentNow` is whatever
 * the last tick left, possibly hours ago. React reads the snapshot for a
 * first render *before* `subscribe` runs, so refresh a cold, stale read here:
 * a mounting screen is then never more than one tick behind, cold or warm.
 * Refreshing only past a whole tick keeps consecutive reads identical, which
 * `useSyncExternalStore` requires of a snapshot.
 */
function getNow(): number {
  if (interval === null && Math.abs(Date.now() - currentNow) >= TICK_MS) {
    currentNow = Date.now();
  }
  return currentNow;
}

/**
 * A clock that is legal to read during render. The snapshot is stable between
 * 30s ticks so `useSyncExternalStore` does not tear.
 *
 * Framework-generic (`setInterval`/`Date.now`/`useSyncExternalStore` all work
 * identically in React Native), so this is the one implementation both web
 * and mobile poll cards read the "is this poll closed yet" clock from —
 * originally web-only (`apps/web/lib/use-now.ts`), moved here for #528.
 */
export function useNow(): number {
  return useSyncExternalStore(subscribe, getNow, getNow);
}

/**
 * The same clock as a `Date`, for callers whose selectors take one. The
 * instance changes only on a tick, so it is safe as a memo dependency.
 *
 * For a screen that buckets rows by "now" on a tab that never unmounts, this
 * is what keeps the buckets moving: React Query's structural sharing keeps
 * `data` referentially stable across a refetch that returns identical rows, so
 * a `new Date()` read once at mount (or in a memo with no time dependency)
 * would freeze them at whatever moment the screen first rendered.
 */
export function useNowDate(): Date {
  const now = useNow();
  return useMemo(() => new Date(now), [now]);
}
