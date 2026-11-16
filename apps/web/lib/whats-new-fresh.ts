/**
 * Which What's new lines came with the deploy this browser is running, so the
 * notes can set them apart (Paul, 2026-11-16: on a big day of changes, see
 * what is new since your last update). The rule is `nextReleaseNoteSnapshot`
 * in `@repo/validation`, shared with the phone (`apps/mobile/lib/whats-new-fresh.ts`);
 * this file keeps the browser's snapshot in `localStorage`.
 *
 * It is worked out once per page load ({@link startWhatsNewFresh}, which the
 * What's new host calls on every page), not when What's new is opened, so a
 * deploy this browser loaded but never opened the notes on still counts as
 * the last update. The notes ship in the bundle, so a page load is the only
 * time they change.
 */

import { useSyncExternalStore } from "react";
import {
  RELEASE_NOTES,
  nextReleaseNoteSnapshot,
  parseReleaseNoteSnapshot,
} from "@repo/validation";

/** The newest entry as the last deploy had it, and the lines it brought. */
export const WHATS_NEW_SNAPSHOT_STORAGE_KEY = "frapp.web.whats-new-snapshot";

const NONE: readonly string[] = Object.freeze([]);

let fresh: readonly string[] | null = null;

/**
 * Works out this page load's fresh lines, once, and stores the snapshot.
 * Blocked storage marks nothing.
 */
export function startWhatsNewFresh(): readonly string[] {
  if (fresh !== null) return fresh;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(WHATS_NEW_SNAPSHOT_STORAGE_KEY);
  } catch {
    // Unreadable reads as no snapshot, which marks nothing.
  }
  const stored = parseReleaseNoteSnapshot(raw);
  const next = nextReleaseNoteSnapshot(RELEASE_NOTES, stored);
  if (next !== null && next !== stored) {
    try {
      window.localStorage.setItem(
        WHATS_NEW_SNAPSHOT_STORAGE_KEY,
        JSON.stringify(next),
      );
    } catch {
      // The marks last this page load only.
    }
  }
  fresh = next?.fresh ?? NONE;
  return fresh;
}

const subscribe = () => () => {};

/** The lines this deploy brought; none while rendering on the server. */
export function useFreshReleaseLines(): readonly string[] {
  return useSyncExternalStore(subscribe, startWhatsNewFresh, () => NONE);
}

/** Test seam: a fresh page load. */
export function resetWhatsNewFreshForTests(): void {
  fresh = null;
}
