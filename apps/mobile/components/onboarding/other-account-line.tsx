import { StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import {
  OTHER_ACCOUNT_ACTION,
  OTHER_ACCOUNT_HINT,
  OTHER_ACCOUNT_PROMPT,
} from "@repo/validation";
import { OnboardingPressable } from "@/components/onboarding/onboarding-pressable";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * "Already in a chapter? Use a different account", one quiet line under s02's
 * two answers (`@repo/validation` `other-account` says why it replaced the
 * "New account created" card). The whole line is the button, so the target
 * is the line's full width and height, not just the gold words.
 */
export function OtherAccountLine({
  onPress,
  disabled,
  busy,
}: {
  onPress: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityLabel={`${OTHER_ACCOUNT_PROMPT} ${OTHER_ACCOUNT_ACTION}`}
      accessibilityHint={OTHER_ACCOUNT_HINT}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress();
      }}
      quiet
      style={[styles.line, disabled ? styles.disabled : null]}
    >
      <Text style={styles.prompt}>
        {OTHER_ACCOUNT_PROMPT}{" "}
        <Text style={styles.action}>{OTHER_ACCOUNT_ACTION}</Text>
      </Text>
    </OnboardingPressable>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    line: {
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    prompt: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      textAlign: "center",
    },
    action: {
      color: tokens.color.gold.house,
    },
    // A quiet line takes no dim of its own (`OnboardingPressable`).
    disabled: {
      opacity: 0.5,
    },
  });
}
