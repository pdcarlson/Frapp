import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * An action's notice and failure lines: the outcome of the member's last tap,
 * in the caption role, the failure in the destructive colour. Each is read out
 * on Android as it arrives (`accessibilityLiveRegion`), because it is what the
 * member is waiting for.
 *
 * One component for every place those lines are drawn, so a style or
 * accessibility fix reaches all of them: under the button of s10's Start and
 * session cards, and on s10 and s11 at the top of a body that has no card to
 * carry them (an error, a loading state, no zones), where a session that
 * ended or a payment that went through must still reach the member.
 */
export function CardMessages({
  notice,
  failure,
  align,
  placement = "card",
}: {
  notice: string | null;
  failure: string | null;
  align: "left" | "center";
  /**
   * `card` sits under the card's button, a step below it; `screen` is the
   * first thing in the body, which `ScreenShell`'s own gap already spaces.
   */
  placement?: "card" | "screen";
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  if (!notice && !failure) return null;
  const textAlign = align === "center" ? styles.centered : null;
  return (
    <View
      style={[styles.messages, placement === "card" ? styles.inCard : null]}
    >
      {notice ? (
        <Text
          style={[styles.notice, textAlign]}
          accessibilityLiveRegion="polite"
        >
          {notice}
        </Text>
      ) : null}
      {failure ? (
        <Text
          style={[styles.failure, textAlign]}
          accessibilityLiveRegion="polite"
        >
          {failure}
        </Text>
      ) : null}
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    messages: {
      alignSelf: "stretch",
      gap: tokens.spacing.xs,
    },
    inCard: {
      marginTop: tokens.spacing.md,
    },
    notice: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    failure: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    centered: {
      textAlign: "center",
    },
  });
}
