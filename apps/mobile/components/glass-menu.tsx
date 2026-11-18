import { type ReactNode, useState } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  useWindowDimensions,
  View,
} from "react-native";
import Animated, {
  FadeIn,
  FadeOut,
  useReducedMotion,
  withTiming,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { SignetTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { typeRole } from "@/lib/theme";

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
 * - a transparent `Modal`, so it sits over the tab bar and every sheet;
 * - below the press when it fits, above it when it doesn't, never past the
 *   safe area either way (it measures itself first, drawn clear until then);
 * - a small lift out of the pressed row, a plain fade with Reduce Motion on;
 * - closed by a tap outside, Android's back (`onRequestClose`) and
 *   VoiceOver's escape gesture.
 *
 * Moving a screen reader's focus onto the menu is the body's, since only the
 * body knows its first element (`useFocusOnOpen`).
 */
export function GlassMenu({
  visible,
  pageY,
  onClose,
  onDismiss,
  backdropTestID,
  children,
}: {
  visible: boolean;
  /** Where the press landed, in window coordinates. */
  pageY: number;
  onClose: () => void;
  /** iOS only: the modal has finished going (`Modal`'s `onDismiss`). */
  onDismiss?: () => void;
  backdropTestID?: string;
  children: ReactNode;
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onClose}
      onDismiss={onDismiss}
    >
      {visible ? (
        <Placed pageY={pageY} onClose={onClose} backdropTestID={backdropTestID}>
          {children}
        </Placed>
      ) : null}
    </Modal>
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
      borderTopColor: "rgba(0,0,0,0.18)",
    },
    pressed: { backgroundColor: "rgba(255,255,255,0.08)" },
    rowLabel: {
      ...typeRole(tokens.typography.role.body),
      flex: 1,
      color: tokens.color.text.foreground,
    },
    destructive: { color: tokens.color.semantic.destructiveText },
  };
}

const styles = StyleSheet.create({
  scrim: { backgroundColor: "rgba(0,0,0,0.40)" },
  anchor: {
    position: "absolute",
    left: EDGE,
    width: GLASS_MENU_WIDTH,
  },
  // The quick-actions panel's glass, at a menu's radius.
  menu: { borderRadius: 22 },
});
