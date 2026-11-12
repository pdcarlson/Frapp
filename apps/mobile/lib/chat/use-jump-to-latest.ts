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
import { arrivedSince, type LatestRow } from "@repo/chat-core/jump-to-latest";

export type { LatestRow };

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
 * other way back: the thread calls `jumpToLatest` on the Send tap, before the
 * send is awaited, so the member's message never lands out of sight.
 *
 * Per channel (`channelKey`): the thread reuses one screen across channels,
 * and a reader back in history in one channel is not in the next. Kept out of
 * `app/(app)/chat-thread.tsx` so it can be tested.
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
