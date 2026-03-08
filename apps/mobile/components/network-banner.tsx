import { StyleSheet, Text, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";

type NetworkBannerProps = {
  isOnline: boolean | null;
  isInternetReachable: boolean | null;
};

export function NetworkBanner({
  isOnline,
  isInternetReachable,
}: NetworkBannerProps) {
  const offline = isOnline === false || isInternetReachable === false;
  const degraded = isOnline === true && isInternetReachable === null;

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

const styles = StyleSheet.create({
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
    backgroundColor: frappTokens.color.feedback.errorBackground,
    borderBottomColor: frappTokens.color.feedback.errorBorder,
  },
  degradedContainer: {
    backgroundColor: frappTokens.color.feedback.warningBackground,
    borderBottomColor: frappTokens.color.feedback.warningBorder,
  },
  offlineText: {
    color: frappTokens.color.feedback.errorText,
  },
  degradedText: {
    color: frappTokens.color.feedback.warningText,
  },
});
