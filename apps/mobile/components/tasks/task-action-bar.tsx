import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SignetTokens } from "@repo/theme/signet";
import { GlassSurface } from "@/components/glass-surface";
import { floatingTabBarBottom } from "@/lib/floating-chrome";
import { typeRole, useFrappTheme } from "@/lib/theme";

/** A round control's size: §2's 40pt compact step, inside the 44pt slop. */
export const TASK_BAR_BUTTON = 40;

/** The bar's padding around its controls. */
const BAR_PAD = 6;

/** The bar's drawn height: a control and its padding. */
export const TASK_BAR_HEIGHT = TASK_BAR_BUTTON + BAR_PAD * 2;

/**
 * The task screen's controls (#5492): a glass capsule floating at the bottom,
 * under the thumb, as Things 3 puts a to-do's controls in a bar at its foot
 * (Paul, 2026-11-18: "compact icon controls at the bottom"). Over the page,
 * never in it, so nothing moves when a control comes or goes; the screen
 * leaves room under its last section with {@link TaskActionBarSpacer}.
 *
 * Its children are {@link TaskBarPill}, the one thing to do, and
 * {@link TaskBarIcon}s, each a 40pt round with an accessibility label.
 */
export function TaskActionBar({ children }: { children: ReactNode }) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { bottom } = useSafeAreaInsets();
  return (
    <View
      pointerEvents="box-none"
      style={[styles.dock, { bottom: floatingTabBarBottom(bottom) }]}
    >
      <GlassSurface style={styles.bar}>
        <View style={styles.row} accessibilityRole="toolbar">
          {children}
        </View>
      </GlassSurface>
    </View>
  );
}

/** Room under the page's last section, so the bar never covers it. */
export function TaskActionBarSpacer() {
  const { tokens } = useFrappTheme();
  return <View style={{ height: TASK_BAR_HEIGHT + tokens.spacing.lg }} />;
}

/**
 * The bar's one labelled control: a pill with a glyph and its verb, filled
 * with `fill` (the chapter accent for Mark done, the only accent control on
 * the screen; destructive red for Remove in select mode).
 */
export function TaskBarPill({
  label,
  glyph,
  fill,
  ink,
  onPress,
  disabled = false,
  busy = false,
  hint,
}: {
  label: string;
  glyph?: (color: string) => ReactNode;
  fill: string;
  ink: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  hint?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      hitSlop={(tokens.touch.minimum - TASK_BAR_BUTTON) / 2}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: fill },
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={ink} />
      ) : (
        <>
          {glyph ? glyph(ink) : null}
          <Text style={[styles.pillLabel, { color: ink }]} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

/** A 40pt round icon control; the word is its accessibility label. */
export function TaskBarIcon({
  label,
  hint,
  onPress,
  disabled = false,
  children,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  /** The glyph, from `components/control-glyphs.tsx`. */
  children: ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      hitSlop={(tokens.touch.minimum - TASK_BAR_BUTTON) / 2}
      style={({ pressed }) => [
        styles.round,
        disabled ? styles.disabled : null,
        pressed && !disabled ? styles.pressed : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    dock: {
      position: "absolute",
      zIndex: 2,
      left: tokens.spacing.lg,
      right: tokens.spacing.lg,
      alignItems: "center",
    },
    bar: {
      borderRadius: TASK_BAR_HEIGHT / 2,
      maxWidth: "100%",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      padding: BAR_PAD,
    },
    pill: {
      height: TASK_BAR_BUTTON,
      minWidth: TASK_BAR_BUTTON * 2,
      borderRadius: TASK_BAR_BUTTON / 2,
      paddingHorizontal: tokens.spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.sm,
      flexShrink: 1,
    },
    pillLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    round: {
      width: TASK_BAR_BUTTON,
      height: TASK_BAR_BUTTON,
      borderRadius: TASK_BAR_BUTTON / 2,
      alignItems: "center",
      justifyContent: "center",
      backgroundColor: tokens.color.surface.card,
    },
    disabled: {
      opacity: 0.4,
    },
    pressed: {
      opacity: 0.7,
    },
  });
}
