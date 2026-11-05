import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter, type Href } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Path } from "react-native-svg";
import { SignetTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { usePressFeedback } from "@/components/list-section";
import { useChapterBranding } from "@/lib/chapter-branding";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** The capsule as drawn: 36pt tall, fully round, a 44pt target with its slop. */
export const BACK_CAPSULE_HEIGHT = 36;

/**
 * Top padding a screen's scrolling content takes under a pinned capsule: the
 * capsule's offset, its height and the gap to the title.
 */
export function pinnedBackClearance(tokens: SignetTokens): number {
  return tokens.spacing.sm + BACK_CAPSULE_HEIGHT + tokens.spacing.md;
}

/** Where a back row leads: the name it shows, and the route it opens. */
export type BackTarget = {
  /** The destination's name, as its tab or screen title reads ("More"). */
  label: string;
  href: Href;
};

/** s10–s13, s15, s16 and Service hours, each opened from a More row. */
export const BACK_TO_MORE: BackTarget = { label: "More", href: "/more" };
/** s07, opened from an Events row (and from Chat home's Up next). */
export const BACK_TO_EVENTS: BackTarget = { label: "Events", href: "/events" };
/**
 * s14. The board draws `‹ More`, but the inbox's entry is the bell on Chat
 * home since #3362, so its way back is Chat.
 */
export const BACK_TO_CHAT: BackTarget = { label: "Chat", href: "/" };

type BackRowProps = {
  label: string;
  /**
   * A control at the row's far end, where the board draws s15's Edit
   * (`‹ More` … `Edit`) and s12's upload glyph, and setup its progress ticks.
   * Optional; every other screen draws the row alone.
   */
  trailing?: ReactNode;
  /** House gold instead of the chapter accent, for a row in `(auth)`. */
  house?: boolean;
  /** Dims the row and ignores taps, as while a sign-in or a join is in flight. */
  disabled?: boolean;
  /** Defaults to `Back to <label>`; a step-back row names where it steps to. */
  accessibilityLabel?: string;
} & (
  | { href: Href; onPress?: never }
  | {
      /** A step back the screen owns, in place of navigating to `href`. */
      onPress: () => void;
      href?: never;
    }
);

/**
 * The `‹ More` / `‹ Events` row the Canvas board draws above the title on a
 * screen reached from another one (s07, s10–s16, `canvas-screens.dc.html`).
 * `spec/ui/mobile/navigation.md` § Back rows owns the rule.
 *
 * It goes to a fixed destination rather than `router.back()`, as s05's `‹`
 * does (`app/(tabs)/chat-thread.tsx`). These routes are hidden tabs, so a
 * notification tap or a `frapp://` link can open one with nothing behind it,
 * and the row must still land where its label says. A label that names the
 * place it goes is also one a member can trust: `back()` from a screen opened
 * off Chat home would land on Chat under a row that says More. Android's back
 * button keeps the history behavior, which is where a member expects it.
 *
 * A glass capsule, `‹ Events` in a bubble of its own (owner ask 2026-11-05,
 * `spec/ui/mobile/navigation.md` § Back rows). `ScreenShell` pins it at the
 * top left so it never scrolls away; a screen that draws the row inline (the
 * auth steps) gets the same capsule in place.
 *
 * The arrow is the chapter accent, as s05's `‹` and the active tab are, and
 * the name is foreground. The board bakes house gold here because its mock
 * chapter is gold; the owner's rule (2026-11-04, `spec/behavior/branding.md`)
 * puts the accent on every back arrow inside a chapter, and keeps house gold
 * for places with no chapter.
 *
 * Sign-in, join, setup and the chapter picker draw the same row (`‹ Back`,
 * `‹ More`), as the board's s02 does. They pass `house`, because `(auth)` has
 * no chapter to take an accent from, and `onPress`, because their way back is
 * a step inside one route (the email form to the providers, the confirm step
 * to the field), not a tab to open. Two leave their route instead: setup's
 * find step goes back to what opened it (`router.back()`, or `/join` with
 * nothing behind it), and the picker's `‹ More` is its own `router.back()`.
 */
export function BackRow(props: BackRowProps) {
  // Two components rather than a branch inside one: a house row never reads
  // the chapter, so sign-in doesn't ask for a current chapter it can't have.
  return props.house ? (
    <HouseBackRow {...props} />
  ) : (
    <ChapterBackRow {...props} />
  );
}

function ChapterBackRow(props: BackRowProps) {
  const { accent } = useChapterBranding();
  return <BackRowView {...props} color={accent} />;
}

function HouseBackRow(props: BackRowProps) {
  const { tokens } = useFrappTheme();
  // `askText` is the gold the board draws its `‹` rows in (s02's `‹ Back`).
  return <BackRowView {...props} color={tokens.color.gold.askText} />;
}

function BackRowView({
  label,
  href,
  onPress,
  trailing,
  disabled = false,
  accessibilityLabel,
  color,
}: BackRowProps & { color: string }) {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const feedback = usePressFeedback({ onCard: true });

  return (
    <View style={styles.row} testID="back-row">
      <GlassSurface style={[styles.capsule, disabled ? styles.disabled : null]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={accessibilityLabel ?? `Back to ${label}`}
          accessibilityState={disabled ? { disabled } : undefined}
          disabled={disabled}
          // 36pt drawn; the slop brings the target to the 44pt minimum.
          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
          android_ripple={disabled ? undefined : feedback.ripple}
          onPress={() => {
            if (onPress) onPress();
            else if (href) router.navigate(href);
          }}
          style={({ pressed }) => [
            styles.press,
            disabled ? null : feedback.lift(pressed),
          ]}
        >
          <Svg
            width={18}
            height={18}
            viewBox="0 0 24 24"
            fill="none"
            stroke={color}
            strokeWidth={2.2}
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <Path d="m14.5 6-6 6 6 6" />
          </Svg>
          <Text style={styles.text}>{label}</Text>
        </Pressable>
      </GlassSurface>
      {trailing}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    row: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
      marginBottom: tokens.spacing.sm,
    },
    capsule: {
      alignSelf: "flex-start",
      height: BACK_CAPSULE_HEIGHT,
      borderRadius: BACK_CAPSULE_HEIGHT / 2,
    },
    press: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      // Tighter on the arrow's side, as drawn, so the glyph sits in the curve.
      paddingLeft: tokens.spacing.sm,
      paddingRight: tokens.spacing.md,
    },
    // The whole capsule dims while it holds: a control that can't respond looks it.
    disabled: {
      opacity: 0.5,
    },
    text: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}

/**
 * A back capsule pinned over a screen's top left, so the way back never
 * scrolls away (`spec/ui/mobile/navigation.md` § Back rows). Render it inside
 * the screen's safe area, before the scroll view: first in the tree, so a
 * screen reader meets it before the title, and `zIndex` draws it over the
 * content that scrolls under it. The scroll view's content takes
 * `pinnedBackClearance` at its top.
 */
export function PinnedBackRow({
  back,
  trailing,
}: {
  back: BackTarget;
  trailing?: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      // An absolute child ignores the safe area's padding, so it adds the
      // insets itself.
      style={{
        position: "absolute",
        zIndex: 1,
        top: insets.top + tokens.spacing.sm,
        left: insets.left + tokens.spacing.lg,
        right: insets.right + tokens.spacing.lg,
      }}
      pointerEvents="box-none"
    >
      <BackRow label={back.label} href={back.href} trailing={trailing} />
    </View>
  );
}
