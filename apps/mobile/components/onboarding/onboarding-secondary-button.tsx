import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { ONBOARDING_COLUMN_WIDTH } from "./onboarding-primary-button";
import { OnboardingPressable } from "./onboarding-pressable";

/**
 * The outlined button beside `OnboardingPrimaryButton`: components.md
 * § Buttons' Secondary, a card fill under the input border's 14% white, the
 * way the board draws s01's "Continue with Apple". For the action next to the
 * one step forward, never a second gold one: s01's second provider and
 * "Continue with email", and setup's logo button.
 *
 * `leading` sits before the label (a provider's mark, or its spinner while
 * that provider's sign-in runs). `busy` swaps the label for a spinner.
 *
 * Pressed as `ListRow` is, through `OnboardingPressable`: Android ripples,
 * iOS lifts the fill one rung, to the elevated surface (mobile has no
 * `--card-hover`).
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
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? (busy ? label : undefined)}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      rippleColor={styles.ripple.color}
      heldStyle={styles.pressed}
      style={styles.button}
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
    </OnboardingPressable>
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
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.card,
      // The Primary step (foundations.md §9): a full-width button that ends
      // a flow step, the same 48 as the sheet CTAs.
      minHeight: tokens.touch.buttonLarge,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
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
