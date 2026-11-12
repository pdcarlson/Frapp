import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  AccessibilityInfo,
  BackHandler,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, { FadeIn, FadeOut } from "react-native-reanimated";
import Svg, { Path } from "react-native-svg";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useCurrentUser } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { useChapterBranding } from "@/lib/chapter-branding";
import { floatingTabBarTop } from "@/lib/floating-chrome";
import {
  ONBOARDING_TOUR_FINISHED_EVENT,
  TOUR_DONE_LABEL,
  TOUR_NEXT_LABEL,
  TOUR_SKIP_LABEL,
  TOUR_STOPS,
  clearTourDue,
  isTourDue,
  onboardingTourFinishedProperties,
  tourCalloutSide,
  tourProgressLabel,
  tourSpot,
  tourStopText,
  type Rect,
  type TourStopKey,
} from "@/lib/onboarding/tour";
import { useLatestTrack } from "@/lib/use-latest-track";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The first-run tour's host and its anchors (`lib/onboarding/tour.ts` has the
 * stops and the rules). The host wraps the tab navigator, so its dimmed layer
 * sits over the screens and the glass tab bar alike, and every stop points at
 * the real control: Chat home's channels, the +, and the You tab.
 */

interface TourContextValue {
  /** A ref callback that marks one stop's control. */
  anchor: (key: TourStopKey) => (node: View | null) => void;
  /** Chat home says when its list has settled, and the chapter's name. */
  setChatReady: (ready: boolean, chapterName: string | null) => void;
}

const NOOP_CONTEXT: TourContextValue = {
  anchor: () => () => undefined,
  setChatReady: () => undefined,
};

const TourContext = createContext<TourContextValue>(NOOP_CONTEXT);

/** Marks the control a stop points at. A no-op outside the tour's host. */
export function useTourAnchor(key: TourStopKey) {
  const { anchor } = useContext(TourContext);
  return useMemo(() => anchor(key), [anchor, key]);
}

/**
 * Chat home's half: the tour starts only once the channel list has loaded (or
 * failed), so its first spot lands on rows, not on the skeleton.
 */
export function useTourReady(ready: boolean, chapterName: string | null) {
  const { setChatReady } = useContext(TourContext);
  useEffect(() => {
    setChatReady(ready, chapterName);
  }, [setChatReady, ready, chapterName]);
}

interface ActiveStop {
  key: TourStopKey;
  text: string;
  spot: Rect;
}

/** Let the list and the bar finish laying out before measuring them. */
const START_DELAY_MS = 400;

function measure(node: View | null): Promise<Rect | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== "function") {
      resolve(null);
      return;
    }
    node.measureInWindow((x, y, width, height) => {
      resolve(width > 0 && height > 0 ? { x, y, width, height } : null);
    });
  });
}

export function TourHost({ children }: { children: ReactNode }) {
  const anchors = useRef(new Map<TourStopKey, View>());
  const rootRef = useRef<View>(null);
  const callbacks = useRef(new Map<TourStopKey, (node: View | null) => void>());
  const [chat, setChat] = useState<{
    ready: boolean;
    chapterName: string | null;
  }>({ ready: false, chapterName: null });
  const [stops, setStops] = useState<ActiveStop[] | null>(null);
  const [index, setIndex] = useState(0);
  // Checked once per mount: a tour that ended, or wasn't due, stays ended.
  const checked = useRef(false);
  const userQuery = useCurrentUser();
  const userId = (userQuery.data as { id?: string } | undefined)?.id ?? null;
  const insets = useSafeAreaInsets();
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const track = useLatestTrack();

  const anchor = useCallback((key: TourStopKey) => {
    let callback = callbacks.current.get(key);
    if (!callback) {
      callback = (node: View | null) => {
        if (node) anchors.current.set(key, node);
        else anchors.current.delete(key);
      };
      callbacks.current.set(key, callback);
    }
    return callback;
  }, []);

  const setChatReady = useCallback(
    (ready: boolean, chapterName: string | null) => {
      setChat((current) =>
        current.ready === ready && current.chapterName === chapterName
          ? current
          : { ready, chapterName },
      );
    },
    [],
  );

  useEffect(() => {
    if (!chat.ready || !userId || checked.current) return;
    checked.current = true;
    let live = true;
    void (async () => {
      if (!(await isTourDue(userId))) return;
      await new Promise((resolve) => setTimeout(resolve, START_DELAY_MS));
      if (!live) return;
      const origin = (await measure(rootRef.current)) ?? {
        x: 0,
        y: 0,
        width: windowWidth,
        height: windowHeight,
      };
      const resolved: ActiveStop[] = [];
      for (const stop of TOUR_STOPS) {
        const control = await measure(anchors.current.get(stop.key) ?? null);
        if (!control) continue;
        const local = {
          ...control,
          x: control.x - origin.x,
          y: control.y - origin.y,
        };
        // The channel list runs under the floating bar; its spot stops above.
        const bottom =
          stop.key === "channels"
            ? origin.height - floatingTabBarTop(insets.bottom) - 8
            : origin.height - insets.bottom;
        const spot = tourSpot(
          local,
          { top: insets.top, bottom, width: origin.width },
          stop.maxHeight,
        );
        if (spot) {
          resolved.push({
            key: stop.key,
            text: tourStopText(stop, chat.chapterName),
            spot,
          });
        }
      }
      if (!live) return;
      if (resolved.length === 0) {
        await clearTourDue();
        return;
      }
      setIndex(0);
      setStops(resolved);
    })();
    return () => {
      live = false;
      // A dependency that changed mid-check (the chapter name arriving, an
      // inset settling) must re-run the check, not leave it marked done.
      checked.current = false;
    };
  }, [
    chat.ready,
    chat.chapterName,
    userId,
    insets.bottom,
    insets.top,
    windowHeight,
    windowWidth,
  ]);

  const end = useCallback(
    (skipped: boolean) => {
      if (!stops) return;
      track(
        ONBOARDING_TOUR_FINISHED_EVENT,
        onboardingTourFinishedProperties({
          skipped,
          stop: index + 1,
          stops: stops.length,
        }),
      );
      setStops(null);
      void clearTourDue();
    },
    [index, stops, track],
  );

  const next = useCallback(() => {
    if (!stops) return;
    if (index + 1 >= stops.length) end(false);
    else setIndex(index + 1);
  }, [end, index, stops]);

  // Android back steps back a stop, and on the first one skips the tour, as
  // it would close a sheet. It never navigates the screen underneath.
  useEffect(() => {
    if (!stops) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (index > 0) setIndex(index - 1);
      else end(true);
      return true;
    });
    return () => sub.remove();
  }, [end, index, stops]);

  const current = stops?.[index] ?? null;

  useEffect(() => {
    if (current) AccessibilityInfo.announceForAccessibility?.(current.text);
  }, [current]);

  const value = useMemo(
    () => ({ anchor, setChatReady }),
    [anchor, setChatReady],
  );

  return (
    <TourContext.Provider value={value}>
      <View ref={rootRef} style={styles.root} collapsable={false}>
        {children}
        {stops && current ? (
          <TourOverlay
            stop={current}
            index={index}
            count={stops.length}
            width={windowWidth}
            height={windowHeight}
            onNext={next}
            onSkip={() => end(true)}
          />
        ) : null}
      </View>
    </TourContext.Provider>
  );
}

/** A full-window rectangle with one rounded hole cut out of it. */
export function spotlightPath(
  width: number,
  height: number,
  spot: Rect,
): string {
  const r = Math.min(14, spot.width / 2, spot.height / 2);
  const { x, y } = spot;
  const right = x + spot.width;
  const bottom = y + spot.height;
  return [
    `M0 0H${width}V${height}H0Z`,
    `M${x + r} ${y}H${right - r}`,
    `A${r} ${r} 0 0 1 ${right} ${y + r}V${bottom - r}`,
    `A${r} ${r} 0 0 1 ${right - r} ${bottom}H${x + r}`,
    `A${r} ${r} 0 0 1 ${x} ${bottom - r}V${y + r}`,
    `A${r} ${r} 0 0 1 ${x + r} ${y}Z`,
  ].join("");
}

function TourOverlay({
  stop,
  index,
  count,
  width,
  height,
  onNext,
  onSkip,
}: {
  stop: ActiveStop;
  index: number;
  count: number;
  width: number;
  height: number;
  onNext: () => void;
  onSkip: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const insets = useSafeAreaInsets();
  const overlay = createStyles(tokens);
  const last = index + 1 >= count;
  const side = tourCalloutSide(stop.spot, height);
  const place =
    side === "below"
      ? { top: stop.spot.y + stop.spot.height + 12 }
      : { bottom: height - stop.spot.y + 12 };

  return (
    <Animated.View
      entering={FadeIn.duration(200)}
      exiting={FadeOut.duration(160)}
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      testID="tour-overlay"
    >
      {/* The dimmed layer: a tap anywhere on it, the spot included, goes on.
          The spot is lit, not live, so a tap can't open a channel mid-tour. */}
      <Pressable
        style={StyleSheet.absoluteFill}
        onPress={onNext}
        accessible={false}
      >
        <Svg width={width} height={height}>
          <Path
            d={spotlightPath(width, height, stop.spot)}
            fill={SCRIM}
            fillRule="evenodd"
          />
        </Svg>
      </Pressable>

      <Animated.View
        key={stop.key}
        entering={FadeIn.duration(180)}
        style={[overlay.callout, place]}
      >
        <Text style={overlay.text} accessibilityRole="text">
          {stop.text}
        </Text>
        <View style={overlay.row}>
          <Text style={overlay.progress}>
            {tourProgressLabel(index, count)}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={last ? TOUR_DONE_LABEL : TOUR_NEXT_LABEL}
            hitSlop={12}
            onPress={onNext}
          >
            <Text style={[overlay.action, { color: accent }]}>
              {last ? TOUR_DONE_LABEL : TOUR_NEXT_LABEL}
            </Text>
          </Pressable>
        </View>
      </Animated.View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Skip the tour"
        hitSlop={12}
        onPress={onSkip}
        style={[overlay.skip, { top: insets.top + 10 }]}
      >
        <Text style={overlay.skipText}>{TOUR_SKIP_LABEL}</Text>
      </Pressable>
    </Animated.View>
  );
}

/**
 * The dim, the same 55% black as every sheet and dialog scrim (web's
 * `components/ui/dialog.tsx`); there is no scrim token yet. The Skip on it is
 * white for the same reason: it sits on that black in both themes.
 */
const SCRIM = "rgba(0,0,0,0.55)";
const ON_SCRIM = "rgba(255,255,255,0.88)";

const styles = StyleSheet.create({
  root: { flex: 1 },
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    callout: {
      position: "absolute",
      left: tokens.spacing.lg,
      right: tokens.spacing.lg,
      maxWidth: 380,
      alignSelf: "center",
      backgroundColor: tokens.color.surface.popover,
      borderRadius: tokens.radius.card,
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    text: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.foreground,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    progress: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    action: {
      ...typeRole(tokens.typography.role.label),
    },
    skip: {
      position: "absolute",
      right: tokens.spacing.lg,
    },
    skipText: {
      ...typeRole(tokens.typography.role.label),
      color: ON_SCRIM,
    },
  });
}
