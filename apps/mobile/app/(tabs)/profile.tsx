import { Link } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { frappTokens } from "@repo/theme/tokens";
import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function ProfileScreen() {
  return (
    <ScreenShell
      title="Profile"
      subtitle="Manage your chapter identity, preferences, and notification behavior."
    >
      <InfoCard
        title="Account"
        body="Display name, photo, and bio are visible in directory and chat."
      />
      <InfoCard
        title="Notifications"
        body="Set quiet hours and category-level push preferences for announcements, events, points, and tasks."
      />
      <InfoCard
        title="Theme"
        body="Choose light, dark, or system mode with consistent contrast-safe color roles."
      />
      <Link href="/(auth)/sign-in" asChild>
        <Pressable style={styles.signOutButton}>
          <Text style={styles.signOutText}>Sign out of preview session</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  signOutButton: {
    marginTop: 4,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.errorBorder,
    backgroundColor: frappTokens.color.feedback.errorBackground,
    paddingVertical: 12,
    alignItems: "center",
  },
  signOutText: {
    fontSize: 14,
    fontWeight: "700",
    color: frappTokens.color.feedback.errorText,
  },
});
