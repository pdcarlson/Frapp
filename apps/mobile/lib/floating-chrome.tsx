import {
  createContext,
  type ReactElement,
  type ReactNode,
  useContext,
} from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { hidesTabBar, screenErrorLayout } from "@/components/route-error";

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
 * Bottom padding a scrolling screen adds inside its safe area so its last row
 * clears the floating bar. 0 where no bar floats (a full-window screen, or
 * anything outside the tabs).
 */
export function useTabBarClearance(): number {
  const { tabBar } = useFloatingChrome();
  const { bottom } = useSafeAreaInsets();
  if (!tabBar) return 0;
  return Math.max(floatingTabBarTop(bottom) - bottom, 0) + FLOATING_TAB_BAR.gap;
}

/**
 * The tab navigator's `screenLayout`: the error boundary every screen already
 * gets (`screenErrorLayout`), plus whether a bar floats over it. Module-level
 * for the same reason `screenErrorLayout` is: an inline arrow would remount
 * every screen on each render of the layout.
 */
export function floatingScreenLayout(props: {
  route: { name: string; params?: object };
  navigation: Parameters<typeof screenErrorLayout>[0]["navigation"];
  options: { tabBarStyle?: unknown };
  children: ReactNode;
}): ReactElement {
  return (
    <FloatingChromeContext.Provider
      value={{ tabBar: !hidesTabBar(props.options.tabBarStyle) }}
    >
      {screenErrorLayout(props)}
    </FloatingChromeContext.Provider>
  );
}
