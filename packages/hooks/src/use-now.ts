import { useSyncExternalStore } from "react";

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

function getNow(): number {
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
