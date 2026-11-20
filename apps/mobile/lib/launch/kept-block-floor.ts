import { useSyncExternalStore } from "react";

/**
 * The block list's floor kept from an earlier launch (`first-paint-cache.ts`,
 * #5768), held in memory for the thread. Its own module so the thread reads
 * it without importing the keychain the rest of the kept copy lives in.
 */

const NO_FLOOR: ReadonlySet<string> = new Set();
let floor: ReadonlySet<string> = NO_FLOOR;
const listeners = new Set<() => void>();

/** Sets the kept floor for the scope in effect; `null` clears it. */
export function holdBlockFloor(ids: readonly string[] | null): void {
  const next = ids && ids.length > 0 ? new Set(ids) : NO_FLOOR;
  if (next === floor) return;
  floor = next;
  for (const listener of [...listeners]) listener();
}

/**
 * The ids the last ready block-list read named, kept from an earlier launch.
 * Empty once nothing is kept. The thread unions it in only until the live
 * list has been read (`blockIdsWithFloor`).
 */
export function useKeptBlockFloor(): ReadonlySet<string> {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => floor,
    () => floor,
  );
}
