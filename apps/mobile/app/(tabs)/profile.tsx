import { Link, useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { frappTokens } from "@repo/theme/tokens";
import { InfoCard, ScreenShell } from "@/components/screen-shell";
import { usePreviewSession } from "@/lib/preview-session";

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = usePreviewSession();

  async function handleSignOut() {
    await signOut();
    router.replace("/(auth)/sign-in");
  }

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
      <Link href="/onboarding-tour" asChild>
        <Pressable style={styles.tutorialButton}>
          <Text style={styles.tutorialText}>Revisit onboarding tutorial</Text>
        </Pressable>
      </Link>
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void handleSignOut();
        }}
        style={styles.signOutButton}
      >
          <Text style={styles.signOutText}>Sign out of preview session</Text>
      </Pressable>
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
  tutorialButton: {
    marginTop: 4,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.infoBorder,
    backgroundColor: frappTokens.color.feedback.infoBackground,
    paddingVertical: 12,
    alignItems: "center",
  },
  tutorialText: {
    fontSize: 14,
    fontWeight: "700",
    color: frappTokens.color.feedback.infoTextInteractive,
  },
});
