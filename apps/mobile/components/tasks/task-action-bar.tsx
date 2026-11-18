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
import { usePressFeedback } from "@/components/list-section";
import { floatingTabBarBottom } from "@/lib/floating-chrome";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The task screen's controls (#5492): a glass capsule floating at the bottom,
 * under the thumb, as Things 3 puts a to-do's controls in a bar at its foot
 * (Paul, 2026-11-18: "compact icon controls at the bottom"). Over the page,
 * never in it, so nothing moves when a control comes or goes; the screen
 * leaves room under its last section with {@link TaskActionBarSpacer}.
 *
 * Its children are {@link TaskBarPill}, the one thing to do, and
 * {@link TaskBarIcon}s, each a ghost round icon button with a spoken label.
 * Every control is the touch floor, 44pt (`touch.minimum`, foundations §9),
 * with `spacing.xs` between them and around them.
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

/** The bar's drawn height: a control and the padding around it. */
function barHeight(tokens: SignetTokens): number {
  return tokens.touch.minimum + tokens.spacing.xs * 2;
}

/** Room under the page's last section, so the bar never covers it. */
export function TaskActionBarSpacer() {
  const { tokens } = useFrappTheme();
  return <View style={{ height: barHeight(tokens) + tokens.spacing.lg }} />;
}

/**
 * The bar's one labelled control: a pill with a glyph and its verb, filled
 * with `fill` (the chapter accent for Mark done, the only accent control on
 * the screen; destructive red for Remove in select mode). Its press and
 * disabled states are the primary button's (`SheetPrimaryButton`), with the
 * shared ripple on Android.
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
  const feedback = usePressFeedback({ onCard: true });
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled || busy}
      onPress={onPress}
      android_ripple={disabled ? undefined : feedback.ripple}
      style={({ pressed }) => [
        styles.pill,
        { backgroundColor: fill },
        disabled ? styles.pillDisabled : null,
        pressed && !disabled ? styles.pillPressed : null,
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

/**
 * A round icon control, ghost on the glass as `components.md` § Icon-only
 * actions draws an icon button; the word is its accessibility label. It
 * lifts on a press as a row does (`usePressFeedback`).
 */
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
  const feedback = usePressFeedback({ onCard: true });
  return (
    <View style={styles.roundClip}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={onPress}
        android_ripple={disabled ? undefined : feedback.ripple}
        style={({ pressed }) => [
          styles.round,
          disabled ? styles.pillDisabled : null,
          disabled ? null : feedback.lift(pressed),
        ]}
      >
        {children}
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  const control = tokens.touch.minimum;
  return StyleSheet.create({
    dock: {
      position: "absolute",
      zIndex: 2,
      left: tokens.spacing.lg,
      right: tokens.spacing.lg,
      alignItems: "center",
    },
    bar: {
      borderRadius: barHeight(tokens) / 2,
      maxWidth: "100%",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.xs,
      padding: tokens.spacing.xs,
    },
    pill: {
      height: control,
      borderRadius: control / 2,
      paddingHorizontal: tokens.spacing.lg,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: tokens.spacing.sm,
      overflow: "hidden",
    },
    pillLabel: {
      ...typeRole(tokens.typography.role.label),
    },
    // The primary button's (`sheet-scaffold.tsx`).
    pillDisabled: {
      opacity: 0.5,
    },
    pillPressed: {
      opacity: 0.85,
    },
    // Rounds the lift and the Android ripple (see `usePressFeedback`).
    roundClip: {
      borderRadius: control / 2,
      overflow: "hidden",
    },
    round: {
      width: control,
      height: control,
      alignItems: "center",
      justifyContent: "center",
    },
  });
}
