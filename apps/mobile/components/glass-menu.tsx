import { type ReactNode, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SignetTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { InOverlayLayer } from "@/components/overlay-layer";
import {
  type FocusReturn,
  useBackToClose,
  useReturnFocusOnClose,
} from "@/lib/overlay";
import { typeRole } from "@/lib/theme";
import {
  GLASS_GROUP_BREAK,
  GLASS_MENU_RADIUS,
  GLASS_PRESSED,
  GLASS_SCRIM,
} from "@/lib/glass-paint";

/** The menu's width, and the gap it keeps from the press and the screen edge. */
const GLASS_MENU_WIDTH = 260;
const EDGE = 16;
const GAP = 12;

/**
 * The phone's long-press menu shell (`spec/ui/mobile/patterns.md` § Long-press
 * item menu): a glass card that opens beside the press, over a dim scrim, the
 * way chat home's channel menu opened first (owner, 2026-11-06) and a task's
 * or an event's row opens it now (#5492). The menus draw their own rows; this
 * is everything around them, written once:
 *
 * - drawn in the app's overlay layer (`overlay-layer.tsx`), so it sits over
 *   the tab bar and every sheet but under the update gate, never in a
 *   `Modal`, which would draw over the gate (patterns.md § Overlays, #5517);
 *   the app under it leaves the accessibility tree while it is up;
 * - below the press when it fits, above it when it doesn't, never past the
 *   safe area either way (it measures itself first, drawn clear until then);
 * - a small lift out of the pressed row, a plain fade with Reduce Motion on;
 * - closed by a tap outside, Android's back (`useBackToClose`, ahead of any
 *   sheet under it) and VoiceOver's escape gesture;
 * - a screen reader's focus goes back to the row that opened it on close
 *   (`returnFocusTo`), as a dismissed `Modal` sent it back;
 * - a body that throws is reported and dropped, and the menu closes, while
 *   the app under it stays.
 *
 * Moving a screen reader's focus onto the menu is the body's, since only the
 * body knows its first element (`useFocusOnOpen`). The body renders under the
 * layer's providers, not the screen's (`InOverlayLayer`).
 */
export function GlassMenu({
  visible,
  pageY,
  onClose,
  returnFocusTo,
  backdropTestID,
  children,
}: {
  visible: boolean;
  /** Where the press landed, in window coordinates. */
  pageY: number;
  onClose: () => void;
  /** The row that opened it (`focusReturnOf` its press), if the press named one. */
  returnFocusTo?: FocusReturn | null;
  backdropTestID?: string;
  children: ReactNode;
}) {
  useBackToClose(visible, onClose, "layer");
  useReturnFocusOnClose(returnFocusTo, visible);
  if (!visible) return null;
  return (
    <InOverlayLayer onError={onClose}>
      <Placed pageY={pageY} onClose={onClose} backdropTestID={backdropTestID}>
        {children}
      </Placed>
    </InOverlayLayer>
  );
}

/** Mounted per opening, so a new press measures afresh. */
function Placed({
  pageY,
  onClose,
  backdropTestID,
  children,
}: {
  pageY: number;
  onClose: () => void;
  backdropTestID?: string;
  children: ReactNode;
}) {
  const reduceMotion = useReducedMotion();
  const { height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [menuHeight, setMenuHeight] = useState<number | null>(null);

  const top = (() => {
    if (menuHeight === null) return pageY + GAP;
    const floor = height - insets.bottom - EDGE - menuHeight;
    const below = pageY + GAP;
    if (below <= floor) return below;
    return Math.max(insets.top + EDGE, pageY - GAP - menuHeight);
  })();

  return (
    <View
      style={StyleSheet.absoluteFill}
      accessibilityViewIsModal
      onAccessibilityEscape={onClose}
    >
      <Animated.View
        entering={FadeIn.duration(160)}
        exiting={FadeOut.duration(120)}
        style={StyleSheet.absoluteFill}
      >
        <Pressable
          testID={backdropTestID}
          accessible={false}
          importantForAccessibility="no"
          onPress={onClose}
          style={[StyleSheet.absoluteFill, styles.scrim]}
        />
      </Animated.View>
      <Animated.View
        entering={reduceMotion ? FadeIn.duration(120) : popIn}
        onLayout={(event) => setMenuHeight(event.nativeEvent.layout.height)}
        style={[styles.anchor, { top, opacity: menuHeight === null ? 0 : 1 }]}
      >
        <GlassSurface style={styles.menu}>{children}</GlassSurface>
      </Animated.View>
    </View>
  );
}

/** The menu's entrance: a small lift out of the pressed row, to full size. */
function popIn() {
  "worklet";
  return {
    initialValues: { opacity: 0, transform: [{ scale: 0.92 }] },
    animations: {
      opacity: withTiming(1, { duration: 140 }),
      transform: [{ scale: withTiming(1, { duration: 180 }) }],
    },
  };
}

/**
 * The rows every glass menu draws, so chat home's menu and the item menus
 * can't drift: the quiet caption that names what was pressed, a 48pt row,
 * hairlines between rows (never under the last: with no Cancel row, a
 * closing rule would underline the menu's own edge), the thicker break above
 * a menu's last group (an officer's or a destructive row, so it is never the
 * row right under the thumb that pressed), and the red of a destructive label.
 * Spread into the menu's own `StyleSheet.create`.
 */
export function glassMenuRowStyles(tokens: SignetTokens) {
  return {
    caption: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      paddingHorizontal: tokens.spacing.md,
      paddingTop: tokens.spacing.md,
      paddingBottom: tokens.spacing.xs,
    },
    row: {
      minHeight: 48,
      flexDirection: "row" as const,
      alignItems: "center" as const,
      paddingHorizontal: tokens.spacing.md,
      gap: tokens.spacing.sm,
    },
    divided: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    groupBreak: {
      borderTopWidth: 6,
      borderTopColor: GLASS_GROUP_BREAK,
    },
    pressed: { backgroundColor: GLASS_PRESSED },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      flex: 1,
      color: tokens.color.text.foreground,
    },
    destructive: { color: tokens.color.semantic.destructiveText },
  };
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: GLASS_SCRIM },
  anchor: {
    position: "absolute",
    left: EDGE,
    width: GLASS_MENU_WIDTH,
  },
  // The quick-actions panel's glass, at a menu's radius.
  menu: { borderRadius: GLASS_MENU_RADIUS },
});
