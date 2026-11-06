import { Component, useEffect, type ReactElement, type ReactNode } from "react";
import { StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
import * as Sentry from "@sentry/react-native";
import { usePathname, type ErrorBoundaryProps } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { createReportOnce } from "@repo/observability";
import type { SignetTokens } from "@repo/theme/signet";
import { BACK_TO_CHAT, BackRow } from "@/components/back-row";
import { ErrorState } from "@/components/state-block";
import { FrappThemeProvider, useFrappTheme } from "@/lib/theme";

/**
 * What a member sees when a screen fails to render, and how the failure
 * reaches Sentry (#3378). Before this, nothing in `apps/mobile` caught a render
 * error: one bad screen took the whole app down, with no way back but a
 * relaunch, and Sentry got at most a fatal with no route on it.
 *
 * ## Three boundaries, one surface
 *
 * - **Each tab screen** sits in a `RouteErrorBoundary`, applied by the tab
 *   navigator's `screenLayout` in `app/(tabs)/_layout.tsx`. The tab bar and
 *   every other tab keep working, so this is `writing.md`'s screen row: what
 *   failed is this screen.
 * - **The tab group's layout** and **the root layout** export expo-router's
 *   `ErrorBoundary`, which expo-router renders in place of the layout. They
 *   catch what the screen boundaries can't: a failure in the navigator, the tab
 *   bar, a provider, or a sign-in screen. The app around the screen is gone,
 *   so they use the app row.
 *
 * Both rows are `components.md` §10's Error card, which carries one button:
 * Retry. Where a screen hides the tab bar, its way out is a `‹ Chat` back row
 * above the card, not a second action on it; elsewhere the tab bar is the way
 * out (`spec/ui/mobile/navigation.md` § Back rows).
 *
 * ## Why the root's surface can't use the theme it was given
 *
 * expo-router wraps the root layout's *module*, so the root boundary renders
 * outside every provider that layout mounts. `AppErrorScreen` brings its own
 * `FrappThemeProvider`, which holds static tokens and needs nothing above it.
 * That is also why it draws no back row: with the providers gone there is no
 * session or chapter to go back to, and Retry, which mounts the layout again,
 * is the whole remedy.
 *
 * ## Reporting
 *
 * Catching an error without reporting it would leave the app looking better
 * and reporting less (web's `app/error.tsx` makes the same point). Each error
 * object is reported once, however many times its fallback remounts, through
 * the `createReportOnce` web's `SegmentError` uses. A retry that throws again
 * (Retry, new params, or leaving the screen) usually throws a new object, which
 * is a new report. The event is tagged with the
 * boundary that caught it (`error_boundary`) and the route as a path
 * (`route_path`, such as `/event-details` or `/sign-in`). No route here has a
 * dynamic segment, so a path names a screen and never a record.
 *
 * It carries no React component stack. The shared scrubber keeps only an
 * allowlist of contexts, and `react` is not on it
 * (`packages/observability/src/sentry-scrubbing.ts`), so a stack attached here
 * would be dropped before sending. In a release build the names in it are
 * minified anyway; the route tag and the error's own stack are what place it.
 */

/** Which boundary caught the error, as the `error_boundary` tag. */
export type RouteErrorBoundaryKind = "root" | "tabs" | "screen" | "sheet";

/** Reports a caught render error, once per error object. */
export const reportRouteError = createReportOnce<{
  boundary: RouteErrorBoundaryKind;
  /** The route as a path, when the boundary knows it. */
  routePath?: string;
}>((error, { boundary, routePath }) => {
  Sentry.captureException(error, {
    tags: {
      error_boundary: boundary,
      ...(routePath ? { route_path: routePath } : {}),
    },
  });
});

/** `writing.md` § Mobile render errors, the screen row. */
export const SCREEN_ERROR_COPY = {
  title: "Couldn't load this screen",
  body: "The error has been reported. Retrying usually clears it.",
  retry: "Retry",
} as const;

/** `writing.md` § Mobile render errors, the app row. */
export const APP_ERROR_COPY = {
  title: "Something broke on our side.",
  body: "The error has been reported. Retrying usually clears it.",
  retry: "Retry",
} as const;

/**
 * The root and tab-group layouts' boundary: the whole app area failed, so it
 * fills the window and offers Retry alone. Works with no provider above it:
 * `usePathname` reads expo-router's own store, which the root's boundary still
 * sits inside.
 */
export function AppErrorScreen({
  error,
  retry,
  boundary,
}: ErrorBoundaryProps & {
  boundary: Exclude<RouteErrorBoundaryKind, "screen">;
}) {
  const routePath = usePathname();

  useEffect(() => {
    reportRouteError(error, { boundary, routePath: routePath || undefined });
  }, [error, boundary, routePath]);

  return (
    <FrappThemeProvider>
      <ErrorFrame>
        <ErrorState
          title={APP_ERROR_COPY.title}
          body={APP_ERROR_COPY.body}
          retryLabel={APP_ERROR_COPY.retry}
          onRetry={() => void retry()}
        />
      </ErrorFrame>
    </FrappThemeProvider>
  );
}

/** The tab route that is Chat home (`app/(tabs)/index.tsx`). */
const CHAT_HOME_ROUTE = "index";

/** A tab route's name as the path `usePathname` reports for it. */
function tabRoutePath(route: string): string {
  return route === CHAT_HOME_ROUTE ? "/" : `/${route}`;
}

/**
 * One screen's fallback, filling the screen rather than the window. A screen
 * that hides the tab bar (`FULL_WINDOW` in `app/(tabs)/_layout.tsx`, listed in
 * `spec/ui/mobile/navigation.md` § Tab bar) draws the `‹ Chat` back row: on
 * iOS a member there would otherwise have only a Retry that keeps failing.
 * Every other screen keeps the tab bar, which is its way out.
 */
export function ScreenErrorScreen({
  showBack,
  retry,
}: {
  showBack: boolean;
  retry: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { top } = useSafeAreaInsets();
  const styles = createStyles(tokens);

  return (
    <View style={[styles.screen, { paddingTop: top + tokens.spacing.sm }]}>
      {!showBack ? null : (
        <View style={styles.backRow}>
          <BackRow {...BACK_TO_CHAT} />
        </View>
      )}
      <ErrorFrame>
        <ErrorState
          title={SCREEN_ERROR_COPY.title}
          body={SCREEN_ERROR_COPY.body}
          retryLabel={SCREEN_ERROR_COPY.retry}
          onRetry={retry}
        />
      </ErrorFrame>
    </View>
  );
}

/** What `screenLayout` hands a screen's boundary of its navigation object. */
type ScreenEvents = {
  addListener: (event: "blur", callback: () => void) => () => void;
};

/**
 * Whether a screen's options hide the tab bar, as `FULL_WINDOW` does. The tab
 * navigator types `tabBarStyle` as an animated style; `display` is never
 * animated, so flattening it as a plain style reads it correctly.
 */
export function hidesTabBar(tabBarStyle: unknown): boolean {
  return (
    StyleSheet.flatten(tabBarStyle as StyleProp<ViewStyle>)?.display === "none"
  );
}

/**
 * The tab navigator's `screenLayout`: every tab screen in its own boundary.
 *
 * A module-level function on purpose. React Navigation caches each screen's
 * descriptor on its deps, the layout function among them, so an inline arrow
 * would be a new layout on every render of the tab layout and rebuild every
 * mounted screen's element each time.
 */
export function screenErrorLayout({
  route,
  navigation,
  options,
  children,
}: {
  route: { name: string; params?: object };
  navigation: ScreenEvents;
  options: { tabBarStyle?: unknown };
  children: ReactNode;
}): ReactElement {
  return (
    <RouteErrorBoundary
      route={route.name}
      resetKey={paramsKey(route.params)}
      showBack={hidesTabBar(options.tabBarStyle)}
      navigation={navigation}
    >
      {children}
    </RouteErrorBoundary>
  );
}

/** A route's params as a string, so a changed param reads as a changed key. */
function paramsKey(params: object | undefined): string {
  try {
    return JSON.stringify(params ?? null);
  } catch {
    // Params that can't be serialized never reset the boundary; Retry still does.
    return "";
  }
}

type ScreenBoundaryProps = {
  /** The route's name, for the route tag. */
  route: string;
  /** Whether the fallback draws the `‹ Chat` back row: the tab bar is hidden. */
  showBack?: boolean;
  /**
   * Changes when the screen is opened for something else. Tab screens stay
   * mounted, so without this an event that failed would keep its fallback
   * when the member opens a different event on the same screen.
   */
  resetKey: string;
  /**
   * The screen's blur event. A tab screen that failed stays mounted when the
   * member leaves it, so leaving clears the fallback: the screen renders again
   * while they are away, and is back when they return if the failure has
   * passed. If it fails again, they come back to the fallback and its Retry.
   */
  navigation?: ScreenEvents;
  children: ReactNode;
};

type ScreenBoundaryState = { error: unknown; failed: boolean };

/**
 * A class because only a class can catch a render error. `failed` is kept
 * apart from `error` so a thrown `undefined` or `null` still shows the
 * fallback.
 */
export class RouteErrorBoundary extends Component<
  ScreenBoundaryProps,
  ScreenBoundaryState
> {
  state: ScreenBoundaryState = { error: undefined, failed: false };

  private unsubscribe: (() => void) | null = null;

  static getDerivedStateFromError(error: unknown): ScreenBoundaryState {
    return { error, failed: true };
  }

  componentDidMount(): void {
    // Blur, not focus: a focus can arrive in the same transition that made the
    // screen throw (new params opening it), and retrying there would render
    // the failure straight back. A blur is always the member leaving.
    this.unsubscribe =
      this.props.navigation?.addListener("blur", () => {
        if (this.state.failed) this.retry();
      }) ?? null;
  }

  componentWillUnmount(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  componentDidCatch(error: unknown): void {
    reportRouteError(error, {
      boundary: "screen",
      routePath: tabRoutePath(this.props.route),
    });
  }

  componentDidUpdate(
    prev: ScreenBoundaryProps,
    prevState: ScreenBoundaryState,
  ): void {
    // Only a fallback that was already showing resets. When the new params are
    // what made the screen throw, this commit is the one that caught it, and
    // resetting now would render the failing screen straight back.
    if (
      prevState.failed &&
      this.state.failed &&
      prev.resetKey !== this.props.resetKey
    ) {
      this.retry();
    }
  }

  retry = (): void => {
    this.setState({ error: undefined, failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <ScreenErrorScreen
        showBack={this.props.showBack ?? false}
        retry={this.retry}
      />
    );
  }
}

/**
 * Centers the card in whatever it replaces. Centered content clears the notch
 * and the home indicator by itself, which matters at the root, where no
 * safe-area provider is mounted.
 */
function ErrorFrame({ children }: { children: ReactNode }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return <View style={styles.frame}>{children}</View>;
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    screen: {
      flex: 1,
      backgroundColor: tokens.color.surface.background,
    },
    backRow: {
      paddingHorizontal: tokens.spacing.lg,
    },
    frame: {
      flex: 1,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.lg,
      backgroundColor: tokens.color.surface.background,
    },
  });
}
