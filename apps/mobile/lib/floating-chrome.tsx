import {
  createContext,
  type ReactElement,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";
import { useFocusEffect } from "expo-router";
import type {
  LayoutChangeEvent,
  NativeScrollEvent,
  NativeSyntheticEvent,
  ScrollViewProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { screenErrorLayout } from "@/components/route-error";

/**
 * Where the floating glass chrome sits (owner pick 2026-11-05, "Floating bar,
 * no glow"; `spec/ui/mobile/navigation.md` § Tab bar).
 *
 * The tab bar is a capsule that floats over the content rather than a strip
 * across the bottom, so screens scroll under it and need to know how much room
 * to leave. The floating create button sits above it, in the thumb's reach.
 */
export const FLOATING_TAB_BAR = {
  /** The drawn row: the same 62pt the docked bar had (#3344). */
  height: 62,
  /** Gap to each side of the window. */
  side: 14,
  /** Gap above the floating bar for the create button, and below content. */
  gap: 14,
  /**
   * The round glass + beside the bar on a tab screen, the bar's own height,
   * and the gap between the two (owner pick 2026-11-06). The gap is also the
   * space between the bar and the quick-actions panel above it.
   */
  actionButton: 62,
  actionGap: 10,
} as const;

/**
 * The Ask Frapp bar: a glass capsule the width of the tab bar and its +,
 * sitting just above them on the four tab screens, and in their row while
 * the bar is folded ({@link useBarFolded}, #4904) (#4702, Paul 2026-11-13:
 * "in a bar above the normal liquid glass bottom, not only when you open the
 * plus menu"). Only a member who has Ask gets one (`useAiSurfaces`), so
 * everything that floats above the tab bar asks {@link useAskBarLift} how far
 * up to move rather than assuming it is there.
 */
export const FLOATING_ASK_BAR = {
  /** The Default control step, fully round. */
  height: 48,
  /** Between the bar and the tab bar under it. */
  gap: 8,
} as const;

/**
 * The deepest inset a bar may tuck into: the iPhone home indicator's 34pt.
 * Anything deeper is Android's three-button bar, whose buttons it must clear.
 */
const TUCKABLE_INSET = 34;

/**
 * The bar's distance from the window's bottom edge. Over a home indicator or
 * a gesture bar it tucks 8pt into the inset, as iOS's own floating bar does,
 * never closer than 12pt to the edge on a device with no inset. Over
 * Android's three-button bar it sits wholly above the buttons.
 */
export function floatingTabBarBottom(bottomInset: number): number {
  if (bottomInset > TUCKABLE_INSET) return bottomInset + 4;
  return Math.max(bottomInset - 8, 12);
}

/** The top of the bar, measured up from the window's bottom edge. */
export function floatingTabBarTop(bottomInset: number): number {
  return floatingTabBarBottom(bottomInset) + FLOATING_TAB_BAR.height;
}

type FloatingChrome = { tabBar: boolean };

const FloatingChromeContext = createContext<FloatingChrome>({ tabBar: false });

/** Whether this screen sits over the floating tab bar. */
export function useFloatingChrome(): FloatingChrome {
  return useContext(FloatingChromeContext);
}

/**
 * A boolean the tab bar and the tab screens share. They are siblings, not
 * parent and child, so this is a tiny store rather than context: one side
 * writes it, the other reads it.
 */
function createFlagStore() {
  let value = false;
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const read = (): boolean => value;
  return {
    set(next: boolean): void {
      if (value === next) return;
      value = next;
      for (const listener of listeners) listener();
    },
    use(): boolean {
      return useSyncExternalStore(subscribe, read, read);
    },
  };
}

/** Whether the Ask Frapp bar is on screen: the tab bar writes it. */
const askBar = createFlagStore();

/** Called by the tab bar when the bar appears or goes. */
export function setAskBarShown(shown: boolean): void {
  askBar.set(shown);
}

/**
 * How far the Ask Frapp bar raises whatever floats above the tab bar on this
 * screen: the bar and its gap for a member who has Ask, on a tab screen, and
 * 0 anywhere else.
 */
export function useAskBarLift(): number {
  const { tabBar } = useFloatingChrome();
  const shown = askBar.use();
  return tabBar && shown
    ? FLOATING_ASK_BAR.height + FLOATING_ASK_BAR.gap
    : 0;
}

/**
 * Bottom padding a scrolling screen adds inside its safe area so its last row
 * clears the floating bar, and the Ask Frapp bar above it where there is
 * one. 0 where no bar floats: any screen pushed over the tabs, or anything
 * outside them.
 */
export function useTabBarClearance(): number {
  const { tabBar } = useFloatingChrome();
  const { bottom } = useSafeAreaInsets();
  const askLift = useAskBarLift();
  if (!tabBar) return 0;
  return (
    Math.max(floatingTabBarTop(bottom) - bottom, 0) +
    askLift +
    FLOATING_TAB_BAR.gap
  );
}

/** What a tab screen is told: the floating bar sits over all four. */
const UNDER_TAB_BAR: FloatingChrome = { tabBar: true };

/**
 * The tab navigator's `screenLayout`: the error boundary every screen already
 * gets (`screenErrorLayout`), plus that the bar floats over it. Only the four
 * tabs sit under the bar; a screen pushed over them (`app/(app)/_layout.tsx`)
 * covers it and reads the default, no bar. Module-level for the same reason
 * `screenErrorLayout` is: an inline arrow would remount every screen on each
 * render of the layout.
 */
export function floatingScreenLayout(
  props: Parameters<typeof screenErrorLayout>[0],
): ReactElement {
  return (
    <FloatingChromeContext.Provider value={UNDER_TAB_BAR}>
      {screenErrorLayout(props)}
    </FloatingChromeContext.Provider>
  );
}

/**
 * Whether the bar is folded (#4904, Paul's pick of direction A, 2026-11-17:
 * "If you scroll down ... [it] gets shorter ... If you scroll back up ... it
 * comes back ... to full"). Reading down a tab screen folds it and any move
 * back up unfolds it; the tab screens write it through {@link useBarScroll}
 * and the tab bar reads it. A tab screen also unfolds it as it gains or loses
 * focus, so a tab opened at its top, or a sign-out, never starts folded.
 */
const barFold = createFlagStore();

/** Folds or unfolds the bar. */
export function setBarFolded(folded: boolean): void {
  barFold.set(folded);
}

/** Whether the bar is folded now. */
export function useBarFolded(): boolean {
  return barFold.use();
}

/**
 * Where a list was at its last event, how far it has moved down since it
 * last moved up or folded, and its viewport's height.
 */
export type BarScrollState = { y: number; travel: number; viewport: number };

/** The fold's thresholds, read by {@link barFoldAfterScroll}. */
export const BAR_FOLD = {
  /** Above this the list is at its top: the bar stays open. */
  top: 40,
  /** How far down the member must move before the bar folds. */
  travel: 12,
  /** Within this of the end, the list has ended: the bar opens again. */
  end: 4,
} as const;

/**
 * The fold's rule, read on every scroll event and kept apart from the hook so
 * it can be tested without a scroll view: past the first `top` points of a
 * list, `travel` points of moving down folds the bar; any move up, the top
 * (an iPhone's bounce included), the list's end, or a list too short to
 * scroll unfolds it. Travel starts again from 0 after a fold, so a bar some
 * other screen unfolded takes a fresh `travel` to fold again. `folded` is
 * `null` when the event changes nothing.
 */
export function barFoldAfterScroll(
  state: BarScrollState,
  y: number,
  viewport: number,
  content: number,
): { state: BarScrollState; folded: boolean | null } {
  const atEnd = content <= viewport || y + viewport >= content - BAR_FOLD.end;
  if (y < BAR_FOLD.top || atEnd || y < state.y) {
    return { state: { y, travel: 0, viewport }, folded: false };
  }
  // Travel counts from the top's edge, not from the very top.
  const travel = state.travel + y - Math.max(state.y, BAR_FOLD.top);
  if (travel > BAR_FOLD.travel) {
    return { state: { y, travel: 0, viewport }, folded: true };
  }
  return { state: { y, travel, viewport }, folded: null };
}

type BarScrollProps = Pick<
  ScrollViewProps,
  "onScroll" | "scrollEventThrottle" | "onContentSizeChange" | "onLayout"
>;

/**
 * What a tab screen's list spreads onto itself so the bar folds while the
 * member reads down it: the scroll handler (throttled to 16ms), and its
 * content size and layout, so a list that turns too short to scroll (a
 * shorter view, rows filtered away) unfolds the bar with no scroll event.
 * Empty off the tab bar: a pushed screen has no bar to fold. `ScreenShell`
 * spreads it for every screen it hosts; a screen with its own list opts in
 * the same way.
 */
export function useBarScroll(): BarScrollProps {
  const { tabBar } = useFloatingChrome();
  const state = useRef<BarScrollState>({ y: 0, travel: 0, viewport: 0 });
  // Gaining or losing focus starts the screen unfolded, with no travel kept.
  useFocusEffect(
    useCallback(() => {
      if (!tabBar) return undefined;
      state.current = { ...state.current, travel: 0 };
      setBarFolded(false);
      return () => setBarFolded(false);
    }, [tabBar]),
  );
  const onScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      const { contentOffset, layoutMeasurement, contentSize } =
        event.nativeEvent;
      const next = barFoldAfterScroll(
        state.current,
        contentOffset.y,
        layoutMeasurement.height,
        contentSize.height,
      );
      state.current = next.state;
      if (next.folded !== null) setBarFolded(next.folded);
    },
    [],
  );
  const onLayout = useCallback((event: LayoutChangeEvent) => {
    state.current = {
      ...state.current,
      viewport: event.nativeEvent.layout.height,
    };
  }, []);
  const onContentSizeChange = useCallback((_width: number, height: number) => {
    const { viewport } = state.current;
    if (viewport > 0 && height <= viewport) {
      state.current = { ...state.current, travel: 0 };
      setBarFolded(false);
    }
  }, []);
  return tabBar
    ? { onScroll, scrollEventThrottle: 16, onContentSizeChange, onLayout }
    : {};
}
