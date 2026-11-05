import { type ComponentType, ReactNode, useEffect } from "react";
import {
  type DimensionValue,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SignetTokens } from "@repo/theme/signet";
import { ChapterGlyph } from "@/components/more/more-glyphs";
import { useChapterBranding } from "@/lib/chapter-branding";
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
 * ## Why there is no pull-to-refresh anywhere here
 *
 * `ErrorState` takes an explicit `onRetry` because `ScreenShell` owns the
 * `ScrollView` and is frozen under #937's hotspot protocol, so no screen can
 * attach a `RefreshControl`.
 *
 * The second half of that reasoning — "and nothing wires `onlineManager`" — was
 * true until C8 (#998), which binds both `onlineManager` and `focusManager` in
 * `lib/connection/query-connectivity.ts`, so `refetchOnReconnect` now fires and
 * a connectivity blip recovers on its own. The retry control stays regardless:
 * it is still the only recovery from a *server* error, which no amount of
 * connectivity signalling fixes.
 */

type StateBlockProps = {
  title: string;
  body: string;
};

/**
 * Loading.
 *
 * §10 asks for a content-shaped shimmer — "no spinner-in-a-box". This is
 * content-shaped, and each block pulses its opacity ({@link SkeletonBlock}),
 * but it is **not** the shimmer. The specified sweep is a 90° linear gradient,
 * and there is no gradient primitive in this app: `expo-linear-gradient` is not
 * a dependency and `package.json` is frozen, so adding one is an integrator PR
 * rather than part of a screen slice. A pulse needs nothing but Reanimated,
 * which is already here, and it is enough to read as loading rather than as a
 * grey card that looks the same on every screen.
 *
 * TODO-DESIGN: shimmer sweep per components.md §10 (elevated at 25%/75%,
 * highlight `#332E26` at 50%, 260px background-size, 1.4s linear, phase-shared
 * across blocks) once a gradient dependency lands. Nearest pattern used: the
 * neutral blocks at the specified shapes, pulsing between full and half
 * opacity, and still under reduced motion.
 *
 * The card is `surface1`, not the empty and error cards' `card`: a skeleton
 * stands in for a list, and the grouped lists it becomes (`ListSection`) are
 * `surface1`, so a screen no longer changes tone when its rows land.
 */
export function SkeletonLines({
  lines = 3,
  showTile = false,
}: {
  /** Text rows to draw. Widths cycle through the ~45–70% range §10 specifies. */
  lines?: number;
  /** Draw a leading control-sized block, for a list whose rows carry an avatar. */
  showTile?: boolean;
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
      style={[styles.card, styles.skeletonCard]}
    >
      {/* Left-aligned inside the centred card, as the rows they stand for. */}
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
    </View>
  );
}

/** The pulse's low point and its half-cycle: 1 → 0.5 → 1 every 1.2s. */
const PULSE_FLOOR = 0.5;
const PULSE_HALF_MS = 600;

/**
 * One skeleton block, unframed. {@link SkeletonLines} draws its tile and lines
 * with it, and a list whose loading shape is its own rows (Chat home's
 * `ChannelListSkeleton`) places them directly, so the pulse lives here once
 * for both, and so will the shimmer when it lands.
 *
 * Each block runs its own pulse on the UI thread. Blocks that mount together
 * start together, which keeps a skeleton's blocks in step without a shared
 * clock. Under the system's reduced-motion setting the block holds still at
 * full opacity, as it drew before the pulse.
 */
export function SkeletonBlock({
  width,
  height,
  radius,
}: {
  width: DimensionValue;
  height: number;
  /** Defaults to a text line's radius; a control-sized block passes `radius.control`. */
  radius?: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const reduceMotion = useReducedMotion();
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (reduceMotion) {
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
  }, [reduceMotion, opacity]);

  const pulse = useAnimatedStyle(() => ({ opacity: opacity.get() }));

  return (
    <Animated.View
      style={[
        styles.skeletonBlock,
        { width, height },
        radius === undefined ? null : { borderRadius: radius },
        pulse,
      ]}
    />
  );
}

/**
 * Empty — "inviting, never alarming" (§10). Accent and neutral only; a semantic
 * hue here would read as a fault when nothing is wrong.
 *
 * `title` is optional because writing.md gives some empty states none: Chat
 * home's filtered-to-nothing state is a description and an action, and every
 * string it shows lives once in `@repo/hooks` for both clients. Without a
 * title the card draws no title line and no gap for one, so it reads tile,
 * body, action, in that order, to a screen reader as to the eye.
 */
export function EmptyState({
  title,
  body,
  glyph = "+",
  action,
}: {
  title?: string;
  /**
   * A short fact, when the title needs one (a search names its query). Never a
   * line saying what the screen is for (`writing.md` §1): a title alone is a
   * whole empty state.
   */
  body?: string;
  /**
   * The tile's feature glyph: a duotone glyph component, drawn in the chapter
   * accent (§10, iconography.md), or a single character standing in for one.
   *
   * The More hub's glyphs (`components/more/more-glyphs.tsx`) are the
   * transcribed per-feature set, and Documents, Directory and the no-chapter
   * state pass theirs. TODO-DESIGN: the rest of the per-feature set (tasks,
   * dues, study and Chat home's states still pass a character). Nearest
   * pattern used: the accent-tinted tile with a text glyph.
   */
  glyph?: string | ComponentType<{ color: string }>;
  /** The optional CTA, drawn below the body: an {@link EmptyStateAction}. */
  action?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens);
  const GlyphComponent = typeof glyph === "string" ? null : glyph;

  return (
    <View style={styles.card}>
      {/* The tile is decoration: hidden from screen readers, so VoiceOver
          doesn't read a stand-in character ("plus") before the words. */}
      <View
        style={[styles.tile, { backgroundColor: tint(accent) }]}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {typeof glyph === "string" ? (
          <Text style={[styles.glyph, { color: accent }]}>{glyph}</Text>
        ) : GlyphComponent ? (
          <GlyphComponent color={accent} />
        ) : null}
      </View>
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {body ? <Text style={styles.body}>{body}</Text> : null}
      {action}
    </View>
  );
}

/**
 * The empty card's CTA: §10's Tinted button (§3), `accent-3` fill, `accent-7`
 * border and `accent-11` label at 44pt. Tinted's pressed fill is `accent-4`,
 * which `ChapterBranding` doesn't carry, so it fades while held like the error
 * card's retry.
 */
export function EmptyStateAction({
  label,
  onPress,
}: {
  label: string;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  const styles = createStyles(tokens);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={tokens.spacing.sm}
      onPress={onPress}
      style={({ pressed }) => [
        styles.stateButton,
        { backgroundColor: accentSubtle, borderColor: accentBorder },
        pressed ? styles.pressed : null,
      ]}
    >
      <Text style={[styles.actionText, { color: accent }]}>{label}</Text>
    </Pressable>
  );
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
    <EmptyState
      // The Switch chapter row's own glyph, since that row is the way out.
      glyph={ChapterGlyph}
      title="No chapter selected"
      body={`Choose a chapter from More → Switch chapter to see ${noun}.`}
    />
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
    // The tone of the `ListSection` a skeleton turns into (`SkeletonLines`).
    skeletonCard: {
      backgroundColor: tokens.color.surface.surface1,
    },
    errorCard: {
      // The sanctioned semantic border, and the only one in the family.
      borderColor: tint(tokens.color.semantic.destructive, 0.28),
    },
    tile: {
      width: tokens.touch.minimum,
      height: tokens.touch.minimum,
      borderRadius: tokens.radius.card,
      alignItems: "center",
      justifyContent: "center",
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
    glyph: {
      ...typeRole(tokens.typography.role.title),
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
    // (`retry` here, the chapter accent inline in `EmptyStateAction`). §10
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
    actionText: {
      ...typeRole({
        ...tokens.typography.role.label,
        weight: tokens.typography.weight.bold,
      }),
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
