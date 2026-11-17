import { useEffect } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
} from "react-native-reanimated";
import { SignetTokens } from "@repo/theme/signet";
import { useReduceMotion } from "@/lib/use-reduce-motion";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * The pieces of the phone's recorder on a meeting's minutes
 * (`recording-row.tsx`), redrawn after Paul's 2026-11-17 pass: "You don't
 * need like four humongous buttons everywhere ... maybe you use icons, like a
 * pause button and a play button. Or make them small and in the corner, and
 * maybe show like the act of transcribing."
 *
 * Voice Memos, Otter and Granola are the model: a round pause / carry-on
 * control and a round stop, side by side at the row's end, that never trade
 * places; a live sign that work is happening; and quiet words for the rare
 * actions.
 */

const ROUND = 48;
const ROUND_LARGE = 72;

/**
 * A round icon control: 48pt (above the 44pt touch floor), or 72pt for the
 * recorder's own controls pinned at the bottom, which are pressed without
 * looking across a table. `tone="stop"` draws the recorder's red; the rest
 * are the quiet surface.
 */
export function RoundControl({
  label,
  hint,
  onPress,
  disabled = false,
  tone = "quiet",
  size = "regular",
  children,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  tone?: "quiet" | "stop";
  size?: "regular" | "large";
  /** The glyph, from `components/control-glyphs.tsx`. */
  children: React.ReactNode;
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
      style={({ pressed }) => [
        styles.round,
        size === "large" ? styles.large : null,
        tone === "stop" ? styles.stop : null,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      {children}
    </Pressable>
  );
}

/**
 * Three bars that rise and fall while something is being worked on
 * (getting the microphone, saving, uploading, transcribing), so "this takes a
 * few minutes" is something the officer can see happening. Still under
 * Reduce Motion, where the words alone say it.
 */
export function WorkingBars({ color }: { color: string }) {
  return (
    <View
      style={barStyles.bars}
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      {BAR_BEATS.map((duration) => (
        <Bar key={duration} color={color} duration={duration} />
      ))}
    </View>
  );
}

/** Each bar breathes at its own pace, so the three never move as one. */
const BAR_BEATS = [420, 560, 340] as const;

function Bar({ color, duration }: { color: string; duration: number }) {
  const reduce = useReduceMotion();
  const scale = useSharedValue(0.4);
  useEffect(() => {
    if (reduce) {
      cancelAnimation(scale);
      scale.set(0.7);
      return;
    }
    scale.set(
      withRepeat(
        withTiming(1, { duration, easing: Easing.inOut(Easing.ease) }),
        -1,
        true,
      ),
    );
    return () => cancelAnimation(scale);
  }, [reduce, duration, scale]);
  const grow = useAnimatedStyle(() => ({
    transform: [{ scaleY: scale.get() }],
  }));
  return (
    <Animated.View style={[barStyles.bar, { backgroundColor: color }, grow]} />
  );
}

/** A quiet action in words, in the chapter accent, for the rare step. */
export function TextAction({
  label,
  hint,
  onPress,
  disabled = false,
  color,
}: {
  label: string;
  hint?: string;
  onPress: () => void;
  disabled?: boolean;
  color: string;
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
      hitSlop={{ top: 10, bottom: 10, left: 8, right: 8 }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.textAction,
        pressed ? styles.pressed : null,
        disabled ? styles.disabled : null,
      ]}
    >
      <Text style={[styles.textActionLabel, { color }]}>{label}</Text>
    </Pressable>
  );
}

const BAR_WIDTH = 4;
const BAR_HEIGHT = 16;

const barStyles = StyleSheet.create({
  bars: {
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
    height: BAR_HEIGHT,
  },
  bar: {
    width: BAR_WIDTH,
    height: BAR_HEIGHT,
    borderRadius: BAR_WIDTH / 2,
  },
});

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    round: {
      width: ROUND,
      height: ROUND,
      borderRadius: ROUND / 2,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.popover,
    },
    large: {
      width: ROUND_LARGE,
      height: ROUND_LARGE,
      borderRadius: ROUND_LARGE / 2,
    },
    stop: {
      borderColor: tokens.color.semantic.destructive,
      borderWidth: 2,
    },
    pressed: {
      opacity: 0.6,
    },
    disabled: {
      opacity: 0.4,
    },
    textAction: {
      minHeight: 24,
      justifyContent: "center",
    },
    textActionLabel: {
      ...typeRole(tokens.typography.role.label),
    },
  });
}
