import type { ReactNode } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { ONBOARDING_COLUMN_WIDTH } from "./onboarding-primary-button";

/**
 * The outlined button beside `OnboardingPrimaryButton`: components.md
 * § Buttons' Secondary, a card fill under the input border's 14% white, the
 * way the board draws s01's "Continue with Apple" and s03's "Go to chat". For
 * the action next to the one step forward, never a second gold one: s01's
 * second provider and "Continue with email", setup's logo button, and s03's
 * "Go to chat" while the push primer's "Turn on" is the gold one.
 *
 * `leading` sits before the label (a provider's mark, or its spinner while
 * that provider's sign-in runs). `busy` swaps the label for a spinner.
 *
 * Pressed as `ListRow` is: Android ripples, iOS lifts the fill one rung, to
 * the elevated surface (mobile has no `--card-hover`).
 */
export function OnboardingSecondaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  leading,
  accessibilityLabel,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  leading?: ReactNode;
  accessibilityLabel?: string;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (busy ? label : undefined)}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      android_ripple={disabled ? undefined : { color: styles.ripple.color }}
      style={({ pressed }) => [
        styles.button,
        disabled ? styles.disabled : null,
        pressed && !disabled && Platform.OS !== "android"
          ? styles.pressed
          : null,
      ]}
    >
      {busy ? (
        <ActivityIndicator color={tokens.color.text.foreground} />
      ) : (
        <>
          {leading}
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </>
      )}
    </Pressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    button: {
      width: "100%",
      maxWidth: ONBOARDING_COLUMN_WIDTH,
      alignSelf: "center",
      flexDirection: "row",
      gap: tokens.spacing.sm,
      borderRadius: tokens.radius.control,
      overflow: "hidden",
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.card,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    disabled: {
      opacity: 0.55,
    },
    pressed: {
      backgroundColor: tokens.color.surface.popover,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    ripple: {
      color: tint(tokens.color.text.foreground, 0.12),
    },
  });
}
