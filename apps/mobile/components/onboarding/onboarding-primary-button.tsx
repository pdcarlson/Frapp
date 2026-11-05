import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
} from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

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
 * prompt puts it in its card, and sign-in's email form ends on it. This owns
 * how it looks and behaves, so those screens can't drift apart.
 *
 * `busy` swaps the label for a spinner. A disabled button dims, so a member
 * waiting on a slow request doesn't take it for a frozen screen.
 *
 * A press shows, as `ListRow`'s does: Android draws the ripple the tab bar
 * already draws, darkened toward gold's own ink (components.md § Buttons:
 * pressed is the fill plus a dark overlay); iOS has no ripple, so the fill
 * dims while it is held, as the sheet primary's does.
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
      // Keeps Android's ripple inside the rounded corners.
      overflow: "hidden",
      backgroundColor: tokens.color.gold.house,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
      paddingHorizontal: tokens.spacing.md,
    },
    disabled: {
      opacity: 0.55,
    },
    // The sheet primary's held value (`components/sheet-scaffold.tsx`).
    pressed: {
      opacity: 0.85,
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
