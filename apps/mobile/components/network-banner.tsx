import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

type NetworkBannerProps = {
  isOnline: boolean | null;
  isInternetReachable: boolean | null;
};

export function NetworkBanner({
  isOnline,
  isInternetReachable,
}: NetworkBannerProps) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const offline = isOnline === false;
  const degraded = isOnline === true && isInternetReachable === false;

  if (!offline && !degraded) {
    return null;
  }

  const tone = offline ? styles.offlineContainer : styles.degradedContainer;
  const textTone = offline ? styles.offlineText : styles.degradedText;
  const message = offline
    ? "You're offline. Showing available data until connection returns."
    : "Connection is unstable. Some actions may be delayed.";

  return (
    <View style={[styles.container, tone]}>
      <Text style={[styles.text, textTone]}>{message}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: tokens.spacing.lg,
      paddingVertical: tokens.spacing.sm,
      borderBottomWidth: 1,
    },
    text: {
      ...typeRole(tokens.typography.role.caption),
    },
    offlineContainer: {
      backgroundColor: tint(tokens.color.semantic.destructive),
      borderBottomColor: tint(tokens.color.semantic.destructive, 0.3),
    },
    degradedContainer: {
      backgroundColor: tint(tokens.color.semantic.warning),
      borderBottomColor: tint(tokens.color.semantic.warning, 0.3),
    },
    offlineText: {
      color: tokens.color.semantic.destructive,
    },
    degradedText: {
      color: tokens.color.semantic.warning,
    },
  });
}
