import { ActivityIndicator, Pressable, StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

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
 * prompt puts it in its card. This owns how it looks and behaves, so those
 * four screens can't drift apart.
 *
 * `busy` swaps the label for a spinner. A disabled button dims, so a member
 * waiting on a slow request doesn't take it for a frozen screen.
 */
export function OnboardingPrimaryButton({
  label,
  onPress,
  disabled = false,
  busy = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  busy?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={busy ? label : undefined}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, disabled ? styles.disabled : null]}
    >
      {busy ? (
        <ActivityIndicator color={tokens.color.gold.onHouse} />
      ) : (
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
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
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    disabled: {
      opacity: 0.55,
    },
    label: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
  });
}
