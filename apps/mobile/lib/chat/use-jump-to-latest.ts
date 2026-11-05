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

/** The one scroll call the jump needs, as a `FlatList` provides it. */
export interface LatestScrollableList {
  scrollToOffset(params: { offset: number; animated?: boolean }): void;
}

/** Where the reader is, per channel. */
interface AwayState {
  channelKey: string | null;
  /** Scrolled back past one screen from the newest message. */
  away: boolean;
  /** The newest row when they left it, so a later arrival can be noticed. */
  newestWhenLeft: string | null;
}

/**
 * The s05 thread's way back to the newest message, after reading back through
 * history.
 *
 * The list is inverted, so an offset of 0 is the newest message and the offset
 * grows as the reader scrolls up. Past one screen of it the reader is "away":
 * the thread draws a small jump control, and marks it once a newer message
 * than the one they left lands below. Within one screen nothing shows, since
 * the newest rows are still in view.
 *
 * The thread keeps its place while the reader is away through the list's own
 * `maintainVisibleContentPosition`, so arrivals no longer shift what they are
 * reading; this is only the way back and the notice. A send is the other way
 * back: the thread calls `jumpToLatest` when the member sends, so their own
 * message never lands out of sight.
 *
 * Per channel (`channelKey`): the thread reuses one screen, and one list,
 * across channels, and a reader away in one channel is not away in the next.
 * Kept out of `app/(tabs)/chat-thread.tsx` so it can be tested.
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
  const [state, setState] = useState<AwayState>({
    channelKey,
    away: false,
    newestWhenLeft: null,
  });
  // Reset during render when the channel changes, as the thread does its
  // other per-channel state, so no frame draws the last channel's control.
  if (state.channelKey !== channelKey) {
    setState({ channelKey, away: false, newestWhenLeft: null });
  }

  const away = state.channelKey === channelKey && state.away;

  // Read from the scroll handler, which stays one function for the list's
  // life. Mirrored in effects because refs cannot be written in render.
  const viewportRef = useRef(0);
  const newestRef = useRef(newestId);
  const awayRef = useRef(away);
  useEffect(() => {
    newestRef.current = newestId;
  }, [newestId]);
  useEffect(() => {
    awayRef.current = away;
  }, [away]);

  const onLayout = useCallback((event: LayoutChangeEvent) => {
    viewportRef.current = event.nativeEvent.layout.height;
  }, []);

  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const viewport = viewportRef.current;
      // Unmeasured, so there is no screen to be "past" yet.
      if (viewport <= 0) return;
      const away = event.nativeEvent.contentOffset.y > viewport;
      // Only a crossing is a state change: a scroll event fires per frame.
      if (away === awayRef.current) return;
      awayRef.current = away;
      setState((previous) => ({
        ...previous,
        away,
        newestWhenLeft: away ? newestRef.current : null,
      }));
    },
    [],
  );

  /**
   * Scrolls to the newest message. Animated for the control's tap; a send
   * passes `animated: false`, so the list is already at the bottom when the
   * new row lands and `maintainVisibleContentPosition` follows it there,
   * rather than adjusting for it halfway through an animation.
   */
  const jumpToLatest = useCallback(
    (options: { animated?: boolean } = {}) => {
      listRef.current?.scrollToOffset({
        offset: 0,
        animated: options.animated ?? true,
      });
    },
    [listRef],
  );

  return {
    onLayout,
    onScroll,
    jumpToLatest,
    /** Draw the jump control. */
    isAway: away,
    /** A newer message landed since the reader left the newest one. */
    hasNewBelow: away && newestId !== state.newestWhenLeft,
  };
}
