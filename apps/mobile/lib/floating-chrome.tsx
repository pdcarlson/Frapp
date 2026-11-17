import {
  createContext,
  type ReactElement,
  useCallback,
  useContext,
  useRef,
  useSyncExternalStore,
} from "react";
import type { NativeScrollEvent, NativeSyntheticEvent } from "react-native";
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
 * sitting just above them on the four tab screens (#4702, Paul 2026-11-13:
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

/*
 * Whether the Ask Frapp bar is on screen. The tab bar draws it and is a
 * sibling of the tab screens, not a parent, so this is a tiny store rather
 * than context: the tab bar writes it, the screens read it.
 */
let askBarShown = false;
const askBarListeners = new Set<() => void>();

/** Called by the tab bar when the bar appears or goes. */
export function setAskBarShown(shown: boolean): void {
  if (askBarShown === shown) return;
  askBarShown = shown;
  for (const listener of askBarListeners) listener();
}

function subscribeAskBar(listener: () => void): () => void {
  askBarListeners.add(listener);
  return () => askBarListeners.delete(listener);
}

const readAskBarShown = (): boolean => askBarShown;

/**
 * How far the Ask Frapp bar raises whatever floats above the tab bar on this
 * screen: the bar and its gap for a member who has Ask, on a tab screen, and
 * 0 anywhere else.
 */
export function useAskBarLift(): number {
  const { tabBar } = useFloatingChrome();
  const shown = useSyncExternalStore(
    subscribeAskBar,
    readAskBarShown,
    readAskBarShown,
  );
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

/*
 * Whether the bar is folded (#4904, Paul's pick of direction A, 2026-11-17:
 * "If you scroll down ... [it] gets shorter ... If you scroll back up ... it
 * comes back ... to full"). Reading down a tab screen folds the tab bar to its
 * current tab and brings the Ask Frapp bar down into the same row; any move
 * back up unfolds it. The screens' scroll views write it and the tab bar reads
 * it, siblings again, so it is a tiny store like the Ask bar's.
 */
let barFolded = false;
const barFoldListeners = new Set<() => void>();

/** Folds or unfolds the bar. The tab bar also unfolds it on a tab change. */
export function setBarFolded(folded: boolean): void {
  if (barFolded === folded) return;
  barFolded = folded;
  for (const listener of barFoldListeners) listener();
}

function subscribeBarFold(listener: () => void): () => void {
  barFoldListeners.add(listener);
  return () => barFoldListeners.delete(listener);
}

const readBarFolded = (): boolean => barFolded;

/** Whether the bar is folded now. */
export function useBarFolded(): boolean {
  return useSyncExternalStore(subscribeBarFold, readBarFolded, readBarFolded);
}

/** Where a list is, and how far it has moved down since it last moved up. */
export type BarScrollState = { y: number; travel: number };

/**
 * The fold's rule, read on every scroll event: past the first 40pt of a list,
 * 12pt of travel down folds it; any move up, the top (an iPhone's bounce
 * included) or the list's end unfolds it. Kept apart from the hook so it can
 * be tested without a scroll view.
 */
export const BAR_FOLD = {
  /** Above this the list is at its top: the bar stays open. */
  top: 40,
  /** How far down the member must move before the bar folds. */
  travel: 12,
  /** Within this of the end, the list has ended: the bar opens again. */
  end: 4,
} as const;

export function barFoldAfterScroll(
  state: BarScrollState,
  y: number,
  viewport: number,
  content: number,
): { state: BarScrollState; folded: boolean | null } {
  // A list too short to scroll, or one bouncing past its end, never folds.
  const atEnd = content <= viewport || y + viewport >= content - BAR_FOLD.end;
  if (y < BAR_FOLD.top || atEnd || y < state.y) {
    return { state: { y, travel: 0 }, folded: false };
  }
  // Travel counts from the top's edge, not from the very top.
  const travel = state.travel + y - Math.max(state.y, BAR_FOLD.top);
  return {
    state: { y, travel },
    folded: travel > BAR_FOLD.travel ? true : null,
  };
}

/**
 * The scroll handler a tab screen's list passes on (`onScroll`, with a
 * `scrollEventThrottle` of 16) so the bar folds while the member reads down
 * it. `undefined` off the tab bar: a pushed screen has no bar to fold.
 * `ScreenShell` passes it for every screen it hosts; a screen with its own
 * list opts in the same way.
 */
export function useBarScroll():
  | ((event: NativeSyntheticEvent<NativeScrollEvent>) => void)
  | undefined {
  const { tabBar } = useFloatingChrome();
  const state = useRef<BarScrollState>({ y: 0, travel: 0 });
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
  return tabBar ? onScroll : undefined;
}
