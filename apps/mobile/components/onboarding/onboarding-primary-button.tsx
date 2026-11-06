import type { ReactNode } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";
import { OnboardingPressable } from "./onboarding-pressable";

/**
 * The widest an onboarding screen's column, and its pinned button, grows on a
 * tablet: sign-up's join, setup and "You're in." screens share it, so their
 * buttons line up when a member moves between them.
 */
export const ONBOARDING_COLUMN_WIDTH = 400;

/**
 * The one step-forward button on an onboarding screen (#3348 screen rules):
 * house gold, because no chapter's color applies before the member is inside
 * one (`spec/behavior/branding.md` § Brand Boundaries). Join, setup and s03
 * pin it in their own footer, above the keyboard and the inset; the Terms
 * prompt puts it in its card, and sign-in's email form ends on it. The
 * update-required gate (`components/client-policy-gate.tsx`) renders it too,
 * over the whole app, chapter or none: house gold is still right there,
 * because the gate is the product speaking, not a chapter. It is asked
 * before sign-in and drawn outside every chapter's context, so no one
 * chapter's color is the gate's. This owns how it looks and behaves, so
 * those screens can't drift apart.
 *
 * `icon` draws a glyph before the label, in the label's ink, for a button
 * whose verb has a mark people know: setup's `Share invite` draws the
 * platform's share mark. It is a render function so the glyph takes the
 * button's own ink rather than restating it.
 *
 * `busy` swaps the label for a spinner. A disabled button dims, so a member
 * waiting on a slow request doesn't take it for a frozen screen.
 *
 * A press shows through `OnboardingPressable`: on Android a ripple darkened
 * toward gold's own ink (components.md § Buttons: pressed is the fill plus a
 * dark overlay), and on iOS the fill dims while it is held.
 */
export function OnboardingPrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
  icon,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
  icon?: (color: string) => ReactNode;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityLabel={busy ? label : undefined}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      rippleColor={styles.ripple.color}
      style={styles.button}
    >
      {busy ? (
        <ActivityIndicator color={tokens.color.gold.onHouse} />
      ) : icon ? (
        <View style={styles.row}>
          {icon(tokens.color.gold.onHouse)}
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
        </View>
      ) : (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
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
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      // The Primary step (foundations.md §9): a full-width button that ends
      // a flow step, the same 48 as the sheet CTAs.
      minHeight: tokens.touch.buttonLarge,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
    // Not a style a view takes: the ripple's color, kept in the factory so
    // it derives from a token like everything else here.
    ripple: {
      color: tint(tokens.color.gold.onHouse, 0.16),
    },
  });
}
