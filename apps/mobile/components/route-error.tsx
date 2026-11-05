import {
  Component,
  useEffect,
  type ReactElement,
  type ReactNode,
} from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import * as Sentry from "@sentry/react-native";
import { useRouter, type ErrorBoundaryProps } from "expo-router";
import type { SignetTokens } from "@repo/theme/signet";
import { ErrorState } from "@/components/state-block";
import { FrappThemeProvider, typeRole, useFrappTheme } from "@/lib/theme";

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
 * ## Why the root's surface can't use the theme it was given
 *
 * expo-router wraps the root layout's *module*, so the root boundary renders
 * outside every provider that layout mounts. `AppErrorScreen` brings its own
 * `FrappThemeProvider`, which holds static tokens and needs nothing above it.
 * That is also why it offers no Back to chat: with the providers gone there is
 * no session or router state to go back to, and Retry, which mounts the root
 * layout again, is the whole remedy.
 *
 * ## Reporting
 *
 * Catching an error without reporting it would leave the app looking better
 * and reporting less (web's `app/error.tsx` makes the same point). Each error
 * is reported once, however many times the fallback remounts, as web's
 * `SegmentError` does: one error object, one event. The event carries which
 * boundary caught it and, for a screen, the route's name, as tags.
 *
 * It carries no React component stack. The shared scrubber keeps only an
 * allowlist of contexts, and `react` is not on it
 * (`packages/observability/src/sentry-scrubbing.ts`), so a stack attached here
 * would be dropped before sending. In a release build the names in it are
 * minified anyway; the route tag and the error's own stack are what place it.
 */
const REPORTED = new WeakSet<object>();

/** Which boundary caught the error, as the `error_boundary` tag. */
export type RouteErrorBoundaryKind = "root" | "tabs" | "screen";

/**
 * Reports a caught render error once. A thrown non-object can't go in the
 * `WeakSet`, so it is reported every time; web makes the same trade.
 */
export function reportRouteError(
  error: unknown,
  context: {
    boundary: RouteErrorBoundaryKind;
    /** The route's name, for a screen boundary. */
    route?: string;
  },
): void {
  if (typeof error === "object" && error !== null) {
    if (REPORTED.has(error)) return;
    REPORTED.add(error);
  }
  Sentry.captureException(error, {
    tags: {
      error_boundary: context.boundary,
      ...(context.route ? { route_name: context.route } : {}),
    },
  });
}

/** `writing.md` § Mobile render errors, the screen row. */
export const SCREEN_ERROR_COPY = {
  title: "Couldn't load this screen",
  body: "The error has been reported. Retrying usually clears it.",
  retry: "Retry",
  back: "Back to chat",
} as const;

/** `writing.md` § Mobile render errors, the app row. */
export const APP_ERROR_COPY = {
  title: "Something broke on our side.",
  body: "The error has been reported. Retrying usually clears it.",
  retry: "Retry",
} as const;

/**
 * The root and tab-group layouts' boundary: the whole app area failed, so it
 * fills the window and offers Retry alone. Works with no provider above it.
 */
export function AppErrorScreen({
  error,
  retry,
  boundary,
}: ErrorBoundaryProps & { boundary: Exclude<RouteErrorBoundaryKind, "screen"> }) {
  useEffect(() => {
    reportRouteError(error, { boundary });
  }, [error, boundary]);

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

/**
 * One screen's fallback. The tab bar is still there, so it fills the screen
 * rather than the window, and a screen other than Chat home also offers Back
 * to chat: the chat thread and both check-in screens hide the tab bar, and on
 * iOS a member there would otherwise have only a Retry that keeps failing.
 */
export function ScreenErrorScreen({
  route,
  retry,
}: {
  route: string;
  retry: () => void;
}) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <ErrorFrame>
      <ErrorState
        title={SCREEN_ERROR_COPY.title}
        body={SCREEN_ERROR_COPY.body}
        retryLabel={SCREEN_ERROR_COPY.retry}
        onRetry={retry}
      />
      {route === CHAT_HOME_ROUTE ? null : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={SCREEN_ERROR_COPY.back}
          hitSlop={tokens.spacing.sm}
          onPress={() => router.navigate("/(tabs)")}
          style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}
        >
          <Text style={styles.backText}>{SCREEN_ERROR_COPY.back}</Text>
        </Pressable>
      )}
    </ErrorFrame>
  );
}

/** The tab route that is Chat home (`app/(tabs)/index.tsx`). */
const CHAT_HOME_ROUTE = "index";

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
  children,
}: {
  route: { name: string; params?: object };
  children: ReactNode;
}): ReactElement {
  return (
    <RouteErrorBoundary route={route.name} resetKey={paramsKey(route.params)}>
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
  /** The route's name: the `route_name` tag, and whether Back to chat shows. */
  route: string;
  /**
   * Changes when the screen is opened for something else. Tab screens stay
   * mounted, so without this an event that failed would keep its fallback
   * when the member opens a different event on the same screen.
   */
  resetKey: string;
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

  static getDerivedStateFromError(error: unknown): ScreenBoundaryState {
    return { error, failed: true };
  }

  componentDidCatch(error: unknown): void {
    reportRouteError(error, { boundary: "screen", route: this.props.route });
  }

  componentDidUpdate(prev: ScreenBoundaryProps): void {
    if (this.state.failed && prev.resetKey !== this.props.resetKey) {
      this.retry();
    }
  }

  retry = (): void => {
    this.setState({ error: undefined, failed: false });
  };

  render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return <ScreenErrorScreen route={this.props.route} retry={this.retry} />;
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
    frame: {
      flex: 1,
      justifyContent: "center",
      gap: tokens.spacing.sm,
      paddingHorizontal: tokens.spacing.lg,
      backgroundColor: tokens.color.surface.background,
    },
    back: {
      alignSelf: "center",
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.lg,
    },
    backText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
