import { StyleSheet, Text, View } from "react-native";
import { FrappTokens } from "@repo/theme/tokens";
import { useFrappTheme } from "@/lib/theme";

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

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    container: {
      paddingHorizontal: 16,
      paddingVertical: 8,
      borderBottomWidth: 1,
    },
    text: {
      fontSize: 12,
      fontWeight: "600",
    },
    offlineContainer: {
      backgroundColor: tokens.color.feedback.errorBackground,
      borderBottomColor: tokens.color.feedback.errorBorder,
    },
    degradedContainer: {
      backgroundColor: tokens.color.feedback.warningBackground,
      borderBottomColor: tokens.color.feedback.warningBorder,
    },
    offlineText: {
      color: tokens.color.feedback.errorText,
    },
    degradedText: {
      color: tokens.color.feedback.warningText,
    },
  });
}
