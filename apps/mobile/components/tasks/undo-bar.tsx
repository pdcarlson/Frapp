import { useEffect } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, Text } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { useChapterBranding } from "@/lib/chapter-branding";
import { GlassSurface } from "@/components/glass-surface";
import {
  FLOATING_TAB_BAR,
  floatingTabBarTop,
  useFloatingChrome,
} from "@/lib/floating-chrome";

/** How long the bar offers Undo, the length Mail and Gmail give an undo. */
export const UNDO_WINDOW_MS = 5000;

/**
 * "Marked done · Undo", floating just above the tab bar for a few seconds
 * after the checkbox completes a task (owner audit 2026-11-06, P6.1: a stray
 * tap used to complete a task for good).
 *
 * Over the list, never in it, so no row moves when it appears or goes
 * (owner rule 2026-11-06: status never shifts layout). Glass like the bar
 * under it, with Undo in the chapter accent as the one action on it. The
 * checkbox itself also unchecks until an officer confirms, so this is the
 * discoverable path, not the only one.
 *
 * The screen owns the timer and passes `message` only while it runs.
 */
export function UndoBar({
  message,
  onUndo,
}: {
  message: string;
  onUndo: () => void;
}) {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const { tabBar } = useFloatingChrome();
  const { bottom } = useSafeAreaInsets();
  const styles = createStyles(tokens);

  useEffect(() => {
    // A screen-reader user hears what happened and that Undo is there, since
    // focus stays on the row they tapped.
    AccessibilityInfo.announceForAccessibility(`${message}. Undo available.`);
  }, [message]);

  const offset = tabBar
    ? floatingTabBarTop(bottom) + FLOATING_TAB_BAR.gap
    : bottom + tokens.spacing.lg;

  return (
    <GlassSurface style={[styles.bar, { bottom: offset }]}>
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Undo"
        hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
        onPress={onUndo}
      >
        <Text style={[styles.undo, { color: accent }]}>Undo</Text>
      </Pressable>
    </GlassSurface>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    bar: {
      position: "absolute",
      zIndex: 2,
      left: tokens.spacing.lg,
      right: tokens.spacing.lg,
      minHeight: tokens.touch.minimum,
      borderRadius: tokens.touch.minimum / 2,
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      paddingHorizontal: tokens.spacing.lg,
    },
    message: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
      flex: 1,
    },
    undo: {
      ...typeRole(tokens.typography.role.label),
    },
  });
}
