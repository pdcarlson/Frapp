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
 * A quiet line on the join screen: a muted prompt with a gold action after it,
 * where the whole line is the button, so the target is the line's full width
 * and height, not just the gold words. "Starting a chapter? Create a chapter"
 * under Paste (#5626), and {@link OtherAccountLine}.
 */
export function PromptLine({
  prompt,
  action,
  hint,
  onPress,
  disabled,
  busy = false,
}: {
  prompt: string;
  action: string;
  hint: string;
  onPress: () => void;
  disabled: boolean;
  busy?: boolean;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  return (
    <OnboardingPressable
      accessibilityRole="button"
      accessibilityLabel={`${prompt} ${action}`}
      accessibilityHint={hint}
      accessibilityState={{ disabled, busy }}
      disabled={disabled}
      onPress={() => {
        if (!disabled) onPress();
      }}
      quiet
      style={[styles.line, disabled ? styles.disabled : null]}
    >
      <Text style={styles.prompt}>
        {prompt} <Text style={styles.action}>{action}</Text>
      </Text>
    </OnboardingPressable>
  );
}

/**
 * "Already in a chapter? Use a different account", one quiet line on s02's
 * question (`@repo/validation` `other-account` says why it replaced the "New
 * account created" card).
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
  return (
    <PromptLine
      prompt={OTHER_ACCOUNT_PROMPT}
      action={OTHER_ACCOUNT_ACTION}
      hint={OTHER_ACCOUNT_HINT}
      onPress={onPress}
      disabled={disabled}
      busy={busy}
    />
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
