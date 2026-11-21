/**
 * Which What's new lines came with the update this phone is running, so the
 * notes can set them apart (Paul, 2026-11-16: on a big day of changes, see
 * what is new since your last update). The rule is `nextReleaseNoteSnapshot`
 * in `@repo/validation`, shared with the web (`apps/web/lib/whats-new-fresh.ts`);
 * this file keeps the phone's snapshot in AsyncStorage.
 *
 * The notes ship in the JS bundle, so they only change with a new process
 * (an over-the-air update reloads the bundle; a store update relaunches the
 * app). The root layout starts the one read per process at module load
 * ({@link startWhatsNewFresh}), so an update counts even if What's new is
 * never opened on it.
 */

import { useSyncExternalStore } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  RELEASE_NOTES,
  nextReleaseNoteSnapshot,
  parseReleaseNoteSnapshot,
} from "@repo/validation";

/** The newest entry as the last update had it, and the lines it brought. */
export const WHATS_NEW_SNAPSHOT_STORAGE_KEY = "frapp.mobile.whats-new-snapshot";

type Storage = Pick<typeof AsyncStorage, "getItem" | "setItem">;

const NONE: readonly string[] = Object.freeze([]);

let fresh: readonly string[] = NONE;
let started: Promise<void> | null = null;
const listeners = new Set<() => void>();

/**
 * Works out this process's fresh lines, once, and stores the snapshot.
 * Storage that fails marks nothing.
 */
export function startWhatsNewFresh(
  storage: Storage = AsyncStorage,
): Promise<void> {
  if (!started) {
    started = (async () => {
      let raw: string | null = null;
      try {
        raw = await storage.getItem(WHATS_NEW_SNAPSHOT_STORAGE_KEY);
      } catch {
        // Unreadable reads as no snapshot, which marks nothing.
      }
      const stored = parseReleaseNoteSnapshot(raw);
      const next = nextReleaseNoteSnapshot(RELEASE_NOTES, stored);
      if (next !== null && next !== stored) {
        try {
          await storage.setItem(
            WHATS_NEW_SNAPSHOT_STORAGE_KEY,
            JSON.stringify(next),
          );
        } catch {
          // The marks last this process only.
        }
      }
      fresh = next?.fresh ?? NONE;
      for (const listener of listeners) listener();
    })();
  }
  return started;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

const read = () => fresh;

/** The lines this update brought; none until the read lands. */
export function useFreshReleaseLines(): readonly string[] {
  return useSyncExternalStore(subscribe, read, read);
}

/** Test seam: a fresh process. */
export function resetWhatsNewFreshForTests(): void {
  fresh = NONE;
  started = null;
  listeners.clear();
}
