import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";

/**
 * How close to the newest message, in points, the list still follows an
 * arrival: `maintainVisibleContentPosition.autoscrollToTopThreshold` on the
 * thread's list. Past it a new message lands out of sight, which is the line
 * this hook watches.
 */
export const FOLLOW_ARRIVALS_WITHIN = 80;

/** The one scroll call the jump needs, as a `FlatList` provides it. */
export interface LatestScrollableList {
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

/**
 * How far back the reader is. `newest`: within the follow threshold, where an
 * arrival scrolls into view by itself. `near`: past it but within one screen.
 * `away`: more than one screen back.
 */
type Zone = "newest" | "near" | "away";

/**
 * One row of the thread, newest first as the inverted list draws it: its
 * stable key (`client_message_id`, unchanged through confirmation) and whether
 * it is the viewer's own send from this device that the server has not echoed
 * yet (any `_status` but `confirmed`). Such a row is never news to them.
 */
export interface LatestRow {
  id: string;
  local: boolean;
}

/** Where the reader is, per channel. */
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
 * Whether a row landed below the reader since they left `newest`, judged on
 * the cache's order as it is now rather than on anything frozen when they
 * left. The newest row's identity or timestamp is not enough:
 *
 * - The viewer's own message is re-sorted when the server confirms it (its
 *   `created_at` becomes the server's), so a device clock ahead of the
 *   server's puts a later arrival behind a timestamp the cache no longer
 *   orders by.
 * - A message queued offline is confirmed after everything backfilled from
 *   the outage, so it comes back newest under the same key with the
 *   backfilled rows beneath it.
 * - Discarding your own failed newest message takes a row away, and the row
 *   before it becomes the newest without anything having arrived.
 *
 * So: a row arrived when its key was not there when they left and it sits
 * newer than the oldest row that was, which every row they could have been
 * reading is. An older page loads past that end and is not news; a removal
 * adds no key. With none of the old rows left (an empty thread when they
 * left), anything there now arrived. The viewer's own unconfirmed sends never
 * count: their row lands a moment before the send that queued it takes them
 * to the newest message, and must not light the dot in between.
 */
function arrivedSince(
  rows: readonly LatestRow[],
  seen: ReadonlySet<string> | null,
): boolean {
  if (seen === null) return false;
  let oldestSeen = rows.length;
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (seen.has(rows[index]!.id)) {
      oldestSeen = index;
      break;
    }
  }
  for (let index = 0; index < oldestSeen; index += 1) {
    const row = rows[index]!;
    if (!row.local && !seen.has(row.id)) return true;
  }
  return false;
}

/**
 * The s05 thread's way back to the newest message, after reading back through
 * history.
 *
 * The list is inverted, so an offset of 0 is the newest message and the offset
 * grows as the reader scrolls up. Within `FOLLOW_ARRIVALS_WITHIN` of it the
 * list follows arrivals, so nothing shows. Past that, an arrival no longer
 * scrolls into view, so once one lands the thread draws a small jump control
 * with a dot that says so, wherever the reader is. Past one screen the control
 * also shows on its own, without the dot, as a way back.
 *
 * The thread keeps its place while the reader is back in history through the
 * list's own `maintainVisibleContentPosition`, so arrivals no longer shift what
 * they are reading; this is only the way back and the notice. A send is the
 * other way back: the thread calls `jumpToLatest` once the composer has
 * queued the member's message, so it never lands out of sight (and a send
 * that queued nothing leaves them where they were reading).
 *
 * Per channel (`channelKey`): the thread reuses one screen across channels,
 * and a reader back in history in one channel is not in the next. Kept out of
 * `app/(tabs)/chat-thread.tsx` so it can be tested.
 */
export function useJumpToLatest<L extends LatestScrollableList>({
  listRef,
  rows,
  channelKey,
}: {
  listRef: RefObject<L | null>;
  /** The thread's rows, newest first; memoised, as it is read per render. */
  rows: readonly LatestRow[];
  channelKey: string | null;
}) {
  const [state, setState] = useState<ReadingState>({
    channelKey,
    zone: "newest",
    seenWhenLeft: null,
  });
  // Reset during render when the channel changes, as the thread does its
  // other per-channel state, so no frame draws the last channel's control.
  if (state.channelKey !== channelKey) {
    setState({ channelKey, zone: "newest", seenWhenLeft: null });
  }

  const zone: Zone = state.channelKey === channelKey ? state.zone : "newest";

  // Read from the scroll handler, which stays one function for the list's
  // life. Mirrored in effects because refs cannot be written in render.
  const viewportRef = useRef(0);
  const rowsRef = useRef(rows);
  const zoneRef = useRef(zone);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  useEffect(() => {
    zoneRef.current = zone;
  }, [zone]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    viewportRef.current = event.nativeEvent.layout.height;
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const viewport = viewportRef.current;
      // Unmeasured, so there is no screen to be "past" yet.
      if (viewport <= 0) return;
      const offset = event.nativeEvent.contentOffset.y;
      const next: Zone =
        offset <= FOLLOW_ARRIVALS_WITHIN
          ? "newest"
          : offset > viewport
            ? "away"
            : "near";
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
        // Remembered from the moment the reader stopped following arrivals,
        // and kept while they move between `near` and `away`.
        seenWhenLeft:
          next === "newest" ? null : (seen ?? previous.seenWhenLeft),
      }));
    },
    [],
  );

  /**
   * Scrolls to the newest message. Animated for the control's tap; a send
   * passes `animated: false`, so the member is at their message at once
   * rather than watching the list run down to it. An unanimated jump is at
   * the bottom at once, so it also clears the control there and then, rather
   * than for the frame after, when the scroll event says they are back.
   */
  const jumpToLatest = useCallback(
    (options: { animated?: boolean } = {}) => {
      const animated = options.animated ?? true;
      listRef.current?.scrollToOffset({ offset: 0, animated });
      if (!animated) {
        zoneRef.current = "newest";
        setState((previous) => ({
          ...previous,
          zone: "newest",
          seenWhenLeft: null,
        }));
      }
    },
    [listRef],
  );

  /** A message landed below the reader since they stopped following arrivals. */
  const seenWhenLeft = state.seenWhenLeft;
  const hasNewBelow = useMemo(
    () => zone !== "newest" && arrivedSince(rows, seenWhenLeft),
    [zone, rows, seenWhenLeft],
  );

  return {
    onLayout,
    onScroll,
    jumpToLatest,
    /** Draw the jump control. */
    showsJump: zone === "away" || hasNewBelow,
    hasNewBelow,
  };
}
