"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  arrivedSince,
  zoneFor,
  type LatestRow,
  type ReadingZone as Zone,
} from "@repo/chat-core/jump-to-latest";

interface ReadingState {
  channelKey: string | null;
  zone: Zone;
  /**
   * Every row's key when they left `newest`, so a later arrival can be told
   * from a row that was already there.
   */
  seenWhenLeft: ReadonlySet<string> | null;
}

/**
 * The web thread's way back to the newest message, after reading back through
 * history: the same rules as mobile's `useJumpToLatest`
 * (`apps/mobile/lib/chat/use-jump-to-latest.ts`), on a list that is not
 * inverted, so the distance that matters is from the scroller's end.
 *
 * Within `followWithin` of the end the list follows arrivals (Virtuoso's
 * `followOutput`), so nothing shows. Past that an arrival lands out of sight,
 * so once one lands the control shows with a dot that says so. Past one screen
 * it also shows on its own, without the dot, as a way back.
 *
 * Per channel (`channelKey`): the timeline keeps one list across channel
 * switches, and a reader back in history in one channel is not in the next.
 *
 * Only a scroll up leaves `newest`. While the list follows an arrival in, its
 * scroll events move down from the arrival's height above the end, and a photo
 * taller than the screen would otherwise flash the control for the length of
 * the animation.
 *
 * `scrollerRef` attaches to Virtuoso's scroller. `markNewest` is for a scroll
 * made there in code (the jump itself, and the timeline's jump on the member's
 * own send), which is at the end at once, so the control clears on that frame
 * rather than the scroll event's.
 */
export function useJumpToLatest({
  rows,
  channelKey,
  followWithin,
}: {
  /** The thread's rows, newest first; memoised, as it is read per render. */
  rows: readonly LatestRow[];
  channelKey: string | null;
  followWithin: number;
}) {
  const [state, setState] = useState<ReadingState>({
    channelKey,
    zone: "newest",
    seenWhenLeft: null,
  });
  // Reset during render when the channel changes, so no frame draws the last
  // channel's control. The timeline opens every channel at its newest row.
  if (state.channelKey !== channelKey) {
    setState({ channelKey, zone: "newest", seenWhenLeft: null });
  }
  const zone: Zone = state.channelKey === channelKey ? state.zone : "newest";

  // Read from the scroll handler, which stays one function for the scroller's
  // life. Mirrored in effects because refs cannot be written in render.
  const rowsRef = useRef(rows);
  const zoneRef = useRef(zone);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    zoneRef.current = zone;
  }, [zone]);

  const moveTo = useCallback((next: Zone) => {
    // Only a crossing is a state change: a scroll event fires per frame.
    if (next === zoneRef.current) return;
    const leftNewest = zoneRef.current === "newest";
    zoneRef.current = next;
    const seen = leftNewest
      ? new Set(rowsRef.current.map((row) => row.id))
      : null;
    setState((previous) => ({
      ...previous,
      zone: next,
      // Remembered from the moment the reader stopped following arrivals, and
      // kept while they move between `near` and `away`.
      seenWhenLeft: next === "newest" ? null : (seen ?? previous.seenWhenLeft),
    }));
  }, []);

  const detach = useRef<(() => void) | null>(null);
  const scrollerRef = useCallback(
    (element: HTMLElement | Window | null) => {
      detach.current?.();
      detach.current = null;
      if (!(element instanceof HTMLElement)) return;
      let lastTop = element.scrollTop;
      const onScroll = () => {
        const top = element.scrollTop;
        const movedUp = top < lastTop;
        lastTop = top;
        // Unmeasured, so there is no screen to be "past" yet.
        if (element.clientHeight <= 0) return;
        const next = zoneFor(
          element.scrollHeight - top - element.clientHeight,
          element.clientHeight,
          followWithin,
        );
        if (zoneRef.current === "newest" && next !== "newest" && !movedUp) {
          return;
        }
        moveTo(next);
      };
      element.addEventListener("scroll", onScroll, { passive: true });
      detach.current = () => element.removeEventListener("scroll", onScroll);
    },
    [followWithin, moveTo],
  );
  useEffect(() => () => detach.current?.(), []);

  const markNewest = useCallback(() => moveTo("newest"), [moveTo]);

  const seenWhenLeft = state.seenWhenLeft;
  const hasNewBelow = useMemo(
    () => zone !== "newest" && arrivedSince(rows, seenWhenLeft),
    [zone, rows, seenWhenLeft],
  );

  return {
    scrollerRef,
    markNewest,
    /** Draw the jump control. */
    showsJump: zone === "away" || hasNewBelow,
    hasNewBelow,
  };
}
