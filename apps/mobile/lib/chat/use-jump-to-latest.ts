import {
  useCallback,
  useEffect,
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

/** Where the reader is, per channel. */
interface ReadingState {
  channelKey: string | null;
  zone: Zone;
  /** The newest row when they left `newest`, so a later arrival can be noticed. */
  newestWhenLeft: string | null;
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
 * other way back: the thread calls `jumpToLatest` when the member sends, so
 * their own message never lands out of sight.
 *
 * Per channel (`channelKey`): the thread reuses one screen across channels,
 * and a reader back in history in one channel is not in the next. Kept out of
 * `app/(tabs)/chat-thread.tsx` so it can be tested.
 */
export function useJumpToLatest<L extends LatestScrollableList>({
  listRef,
  newestId,
  channelKey,
}: {
  listRef: RefObject<L | null>;
  /** The newest row's stable key (`client_message_id`), or `null` for none. */
  newestId: string | null;
  channelKey: string | null;
}) {
  const [state, setState] = useState<ReadingState>({
    channelKey,
    zone: "newest",
    newestWhenLeft: null,
  });
  // Reset during render when the channel changes, as the thread does its
  // other per-channel state, so no frame draws the last channel's control.
  if (state.channelKey !== channelKey) {
    setState({ channelKey, zone: "newest", newestWhenLeft: null });
  }

  const zone: Zone = state.channelKey === channelKey ? state.zone : "newest";

  // Read from the scroll handler, which stays one function for the list's
  // life. Mirrored in effects because refs cannot be written in render.
  const viewportRef = useRef(0);
  const newestRef = useRef(newestId);
  const zoneRef = useRef(zone);
  useEffect(() => {
    newestRef.current = newestId;
  }, [newestId]);
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
      const newest = newestRef.current;
      setState((previous) => ({
        ...previous,
        zone: next,
        // Remembered from the moment the reader stopped following arrivals,
        // and kept while they move between `near` and `away`.
        newestWhenLeft:
          next === "newest"
            ? null
            : leftNewest
              ? newest
              : previous.newestWhenLeft,
      }));
    },
    [],
  );

  /**
   * Scrolls to the newest message. Animated for the control's tap; a send
   * passes `animated: false`, so the list is already at the bottom when the
   * new row lands and `maintainVisibleContentPosition` follows it there,
   * rather than adjusting for it halfway through an animation. An unanimated
   * jump is at the bottom at once, so it also clears the control there and
   * then: the member's own message landing must not light the dot for the
   * frame before the scroll event says they are back.
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
          newestWhenLeft: null,
        }));
      }
    },
    [listRef],
  );

  /** A newer message landed since the reader stopped following arrivals. */
  const hasNewBelow = zone !== "newest" && newestId !== state.newestWhenLeft;

  return {
    onLayout,
    onScroll,
    jumpToLatest,
    /** Draw the jump control. */
    showsJump: zone === "away" || hasNewBelow,
    hasNewBelow,
  };
}
