import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
} from "react";
import {
  AccessibilityInfo,
  type DimensionValue,
  Pressable,
  type StyleProp,
  StyleSheet,
  Text,
  View,
  type ViewStyle,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  type SharedValue,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { NavigationContext } from "expo-router/react-navigation";
import { SignetTokens, type SignetTypeRole } from "@repo/theme/signet";
import { InlineNote } from "@/components/inline-note";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The skeleton / empty / error family, in one place.
 *
 * `spec/ui/design-system/components.md` §10 specs these as one family that is
 * "clearly distinct at a glance", and `spec/ui/mobile/README.md` requires every
 * screen to ship all three — but until now no screen had a shared
 * implementation to reach for, so five of them grew their own byte-identical
 * `stateBlock` / `stateTitle` / `stateBody` / `retryButton` style blocks. That
 * duplication is why the drawn anatomy was never built (no icon tile, no
 * semantic error border) and why the retry button drifted below the 44pt
 * minimum in the newest copies.
 *
 * Which screens use these is found by searching for the exports, not listed
 * here, because the list changes with every migration. Some screens still
 * draw their own copies; moving them over is a mechanical change with its own
 * review surface, tracked in #1050.
 *
 * ## Why `ErrorState` keeps a retry control beside pull-to-refresh
 *
 * Lists refresh on a pull (`ScreenShell`'s `refresh`, #3385), and since C8
 * (#998) `lib/connection/query-connectivity.ts` binds `onlineManager` and
 * `focusManager`, so a connectivity blip recovers on its own. `ErrorState`
 * still takes an explicit `onRetry`: a pull is a gesture nothing on screen
 * announces, and the retry control is the visible, accessible way out of a
 * *server* error, which no connectivity signalling fixes.
 */

type StateBlockProps = {
  title: string;
  body: string;
};

/**
 * Loading.
 *
 * §10 asks for a content-shaped shimmer — "no spinner-in-a-box". This is
 * content-shaped, and its blocks pulse their opacity together
 * ({@link SkeletonPulse}), but it is **not** the shimmer. The specified sweep
 * is a 90° linear gradient, and there is no gradient primitive in this app:
 * `expo-linear-gradient` is not a dependency and `package.json` is frozen, so
 * adding one is an integrator PR rather than part of a screen slice. A pulse
 * needs nothing but Reanimated, which is already here, and it is enough to
 * read as loading rather than as a grey card that looks the same on every
 * screen.
 *
 * TODO-DESIGN: shimmer sweep per components.md §10 (elevated at 25%/75%,
 * highlight `--skeleton-highlight` at 50%, 260px background-size, 1.4s linear, phase-shared
 * across blocks) once a gradient dependency lands. Nearest pattern used: the
 * neutral blocks at the specified shapes, pulsing together between full and
 * half opacity ({@link SkeletonPulse}), still under reduced motion, and paused
 * while their screen is out of view.
 *
 * This is the generic card of bars, and it fits only a state that is itself
 * one card (Ask's answer, a sheet's panel). A screen draws its own layout with
 * {@link SkeletonRegion} and {@link SkeletonText} instead, since one card of
 * bars on every screen is exactly what §10 rules out;
 * `screen-skeletons.spec.tsx` holds the few places still on it.
 *
 * The card takes the shape of what it turns into, so a screen doesn't change
 * when its content lands. Both tones sit on `card`, the fill of the empty and
 * error cards and of a grouped list: `card` (the default) where the skeleton
 * stands in for cards (the next-event card, the Ask answer) or a flush list,
 * `list` where it stands in for a `ListSection`, whose smaller `radius.card`
 * corners it takes.
 */
export function SkeletonLines({
  lines = 3,
  showTile = false,
  tone = "card",
}: {
  /** Text rows to draw. Widths cycle through the ~45–70% range §10 specifies. */
  lines?: number;
  /** Draw a leading control-sized block, for a list whose rows carry an avatar. */
  showTile?: boolean;
  /** The tone of what the skeleton turns into: `card` cards, or a `list` (`ListSection`). */
  tone?: "card" | "list";
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // `as const` so each stays a percentage literal — RN's `DimensionValue`
  // accepts `` `${number}%` ``, not a widened `string`.
  const widths = ["70%", "45%", "60%", "52%"] as const;

  return (
    // `accessible` makes the card one node, so VoiceOver reads the role and
    // label; without it iOS skips a View that has no text and the screen
    // sounds blank while it loads.
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel="Loading"
      style={[styles.card, tone === "list" ? styles.listCard : null]}
    >
      {/* Left-aligned inside the centred card, as the rows they stand for. */}
      <SkeletonPulse>
        <View style={styles.skeletonStack}>
          {showTile ? (
            <SkeletonBlock
              width={tokens.touch.minimum}
              height={tokens.touch.minimum}
              radius={tokens.radius.control}
            />
          ) : null}
          {Array.from({ length: lines }, (_, index) => (
            <SkeletonBlock
              key={index}
              width={widths[index % widths.length]}
              height={tokens.spacing.md}
            />
          ))}
        </View>
      </SkeletonPulse>
    </View>
  );
}

/** The pulse's low point and its half-cycle: 1 → 0.5 → 1 every 1.2s. */
const PULSE_FLOOR = 0.5;
const PULSE_HALF_MS = 600;

/**
 * The pulse a skeleton's blocks share. Everything inside it that draws a
 * {@link SkeletonBlock} reads one opacity, so a skeleton of twenty blocks
 * makes one reduced-motion subscription, one pair of focus and blur
 * listeners and one animation, and its blocks are in step by construction.
 * {@link SkeletonLines} wraps its blocks in one, and {@link SkeletonRegion},
 * which every screen's own skeleton draws in, brings one.
 *
 * The pulse runs on the UI thread. It holds still at full opacity, as the
 * blocks drew before there was a pulse:
 *
 * - under the system's reduced-motion setting, followed live
 *   ({@link useReduceMotion}), so turning it on mid-session stops a pulse
 *   already running;
 * - while its screen is out of view ({@link useScreenInView}). Tab screens stay
 *   mounted after the member leaves them, and a query paused offline keeps
 *   its skeleton up for as long as the device is offline, so without this a
 *   blurred tab's skeleton animated on the UI thread with nobody watching.
 */
export function SkeletonPulse({ children }: { children: ReactNode }) {
  const reduceMotion = useReduceMotion();
  const inView = useScreenInView();
  const still = reduceMotion || !inView;
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (still) {
      opacity.set(1);
      return;
    }
    opacity.set(
      withRepeat(
        withTiming(PULSE_FLOOR, {
          duration: PULSE_HALF_MS,
          easing: Easing.inOut(Easing.ease),
        }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(opacity);
  }, [still, opacity]);

  return (
    <SkeletonPulseContext.Provider value={opacity}>
      {children}
    </SkeletonPulseContext.Provider>
  );
}

/** The opacity of the {@link SkeletonPulse} a block sits in, if any. */
const SkeletonPulseContext = createContext<SharedValue<number> | null>(null);

type SkeletonBlockProps = {
  width: DimensionValue;
  height: number;
  /** Defaults to a text line's radius; a control-sized block passes `radius.control`. */
  radius?: number;
  /** Outer layout only (a margin, `alignSelf`), never the block's own look. */
  style?: StyleProp<ViewStyle>;
};

/**
 * One skeleton block, unframed. {@link SkeletonLines} draws its tile and lines
 * with it, and a list whose loading shape is its own rows places them
 * directly, so the block's look lives here once for both, and so will the
 * shimmer when it lands.
 *
 * It takes its opacity from the {@link SkeletonPulse} around it. A block
 * placed with none brings its own, so it still pulses, at the cost of its own
 * subscriptions.
 */
export function SkeletonBlock(props: SkeletonBlockProps) {
  const pulse = useContext(SkeletonPulseContext);
  if (pulse === null) {
    return (
      <SkeletonPulse>
        <SkeletonBlock {...props} />
      </SkeletonPulse>
    );
  }
  return <PulsedBlock {...props} opacity={pulse} />;
}

function PulsedBlock({
  width,
  height,
  radius,
  style,
  opacity,
}: SkeletonBlockProps & { opacity: SharedValue<number> }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const pulse = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View
      style={[
        style,
        styles.skeletonBlock,
        { width, height },
        radius === undefined ? null : { borderRadius: radius },
        pulse,
      ]}
    />
  );
}

/**
 * A screen's loading state drawn as its own layout: one node to assistive
 * tech, and one {@link SkeletonPulse} for every block inside it.
 *
 * components.md §10: "the skeleton mirrors the layout it becomes — same
 * blocks, same radii". So a screen doesn't reach for one generic card of bars;
 * it draws its own frames (the row card, the list section, the summary card)
 * from the same styles its loaded rows use, and fills them with
 * {@link SkeletonText} and {@link SkeletonBlock}. The real content then lands
 * in place instead of pushing in under a placeholder of another shape.
 *
 * `label` says what is loading ("Loading events"), so a screen reader hears
 * more than "Loading". `style` is the region's own layout, usually
 * `ScreenShell`'s content gap so the frames inside sit where their real
 * counterparts land.
 */
export function SkeletonRegion({
  label,
  style,
  children,
}: {
  label: string;
  style?: StyleProp<ViewStyle>;
  children: ReactNode;
}) {
  return (
    // `accessible` makes the region one node, so VoiceOver reads the role and
    // label; without it iOS skips a View that has no text and the screen
    // sounds blank while it loads.
    <View
      accessible
      accessibilityRole="progressbar"
      accessibilityLabel={label}
      style={style}
    >
      <SkeletonPulse>{children}</SkeletonPulse>
    </View>
  );
}

/**
 * Figtree's vertical metrics, as the font file states them (units per em
 * 1000): ascender 950 and descender 250, so a line with no `lineHeight` is
 * 1.2em tall, and a cap height of 700. These are the font's geometry, not a
 * type style, so deriving a skeleton's line box from a role's size is not the
 * arithmetic on a role that foundations.md §7 bans for setting type.
 */
const FIGTREE_LINE_BOX_EM = 1.2;
const FIGTREE_CAP_HEIGHT_EM = 0.7;

/**
 * One line of text that hasn't loaded: a bar at the role's cap height, centred
 * in the line box the real text will take. A row built from these is as tall
 * as the row it becomes, so nothing below it moves when the text lands.
 *
 * `lineHeight` is for a style that sets its own (Notifications' 20pt rows);
 * otherwise the role's, or the font's natural line.
 */
export function SkeletonText({
  role,
  width,
  lineHeight,
  style,
}: {
  role: SignetTypeRole;
  width: DimensionValue;
  lineHeight?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const box =
    lineHeight ??
    role.lineHeight ??
    Math.round(role.size * FIGTREE_LINE_BOX_EM);
  return (
    <View style={[{ width, height: box, justifyContent: "center" }, style]}>
      <SkeletonBlock
        width="100%"
        height={Math.round(role.size * FIGTREE_CAP_HEIGHT_EM)}
      />
    </View>
  );
}

/**
 * The system's reduced-motion setting, as it is now. Reanimated's
 * `useReducedMotion` is the setting the app launched with and never changes,
 * so it only seeds the first frame here, before the system answers;
 * `AccessibilityInfo` reports the setting when the pulse mounts, and its
 * `reduceMotionChanged` every change after.
 */
function useReduceMotion(): boolean {
  const atLaunch = useReducedMotion();
  // Seeded with the launch value, so an answer that matches it re-renders
  // nothing.
  const [now, setNow] = useState(atLaunch);

  useEffect(() => {
    // A change heard before the first read answers is newer than that read.
    let heard = false;
    const subscription = AccessibilityInfo.addEventListener(
      "reduceMotionChanged",
      (enabled) => {
        heard = true;
        setNow(enabled);
      },
    );
    void AccessibilityInfo.isReduceMotionEnabled().then((enabled) => {
      if (!heard) setNow(enabled);
    });
    return () => {
      heard = true;
      subscription.remove();
    };
  }, []);

  return now;
}

/**
 * Whether the screen this skeleton is on is the one in view: `false` from its
 * navigator's `blur` until its `focus`. A skeleton with no screen around it (in a
 * sheet, which renders above the navigators, or a component outside them)
 * has no blur to wait for and counts as in view.
 */
function useScreenInView(): boolean {
  const navigation = useContext(NavigationContext);
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!navigation) return () => {};
      const offFocus = navigation.addListener("focus", onChange);
      const offBlur = navigation.addListener("blur", onChange);
      return () => {
        offFocus();
        offBlur();
      };
    },
    [navigation],
  );
  return useSyncExternalStore(subscribe, () => navigation?.isFocused() ?? true);
}

/**
 * Error — the one surface allowed a semantic border (§10). Never takes the
 * chapter accent: a chapter's colour saying "something failed" is exactly the
 * confusion the semantic palette exists to prevent.
 */
export function ErrorState({
  title,
  body,
  onRetry,
  retryLabel = "Try again",
  isRetrying = false,
}: StateBlockProps & {
  onRetry?: () => void;
  retryLabel?: string;
  isRetrying?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={[styles.card, styles.errorCard]}>
      {/* Decoration, hidden from screen readers like the empty tile: the
          title already says what went wrong. */}
      <View
        style={styles.errorTile}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <Text style={styles.errorGlyph}>!</Text>
      </View>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.body}>{body}</Text>
      {onRetry ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          accessibilityState={{ disabled: isRetrying }}
          disabled={isRetrying}
          hitSlop={tokens.spacing.sm}
          onPress={onRetry}
          style={({ pressed }) => [
            styles.stateButton,
            styles.retry,
            pressed ? styles.pressed : null,
          ]}
        >
          <Text style={styles.retryText}>
            {isRetrying ? "Retrying…" : retryLabel}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * "No chapter selected" — its own state because it is neither empty nor an
 * error, and because on this app it is the *common* case rather than an edge
 * one: a token with no `active_chapter_id` claim (no membership yet, or the
 * hook disabled as incident mitigation) leaves every chapter-scoped query
 * disabled. A spinner there would hang forever and an error would blame
 * the network for a missing chapter context.
 *
 * Points at the Switch chapter row on More, which is the only entry to the picker
 * (`spec/ui/mobile/navigation.md`).
 */
export function NoChapterState({ noun }: { noun: string }) {
  return (
    <InlineNote>
      {`Choose a chapter from More → Switch chapter to see ${noun}.`}
    </InlineNote>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // The empty and error cards stay on `card`: §10 specs a state that
    // replaces a screen as `--card`, and web's state cards paint it too.
    card: {
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
      alignItems: "center",
    },
    // A skeleton that turns into a `ListSection` takes its tone
    // (`SkeletonLines`'s `tone="list"`).
    listCard: {
      borderRadius: tokens.radius.card,
    },
    errorCard: {
      // The sanctioned semantic border, and the only one in the family.
      borderColor: tint(tokens.color.semantic.destructive, 0.28),
    },
    errorTile: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.card,
      alignItems: "center",
      justifyContent: "center",
      // `tint`'s default alpha is 0.13, which is the danger fill §10 specifies.
      backgroundColor: tint(tokens.color.semantic.destructive),
    },
    errorGlyph: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.semantic.destructive,
    },
    title: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
      textAlign: "center",
    },
    body: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
      // §10 caps the body at ~220px so it never runs the full card width.
      maxWidth: 220,
    },
    // The empty card's CTA and the error card's retry: §10 gives the two cards
    // the same anatomy, so they share this geometry and differ only in colour
    // (`retry` here). §10
    // sets the button 14px below the body; the card's 8pt gap plus `xs` makes
    // 12, the nearest the spacing scale reaches.
    stateButton: {
      marginTop: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
      justifyContent: "center",
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      paddingHorizontal: tokens.spacing.lg,
    },
    retry: {
      borderColor: tokens.color.border.input,
    },
    retryText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    pressed: {
      opacity: 0.7,
    },
    skeletonStack: {
      alignSelf: "stretch",
      alignItems: "flex-start",
      gap: tokens.spacing.sm,
    },
    skeletonBlock: {
      // TODO-DESIGN: §10 specifies radius 6 for skeleton text lines. `chip` (8)
      // is the nearest token; a raw 6 would be a hard-coded value, which
      // foundations.md bans.
      borderRadius: tokens.radius.chip,
      backgroundColor: tokens.color.surface.popover,
    },
  });
}
