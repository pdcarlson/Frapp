import { useRouter } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { InfoCard, ScreenShell } from "@/components/screen-shell";
import { useAuthSession } from "@/lib/auth-session";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

export default function ProfileScreen() {
  const router = useRouter();
  const { email, signOut } = useAuthSession();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

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
        body={
          email
            ? `Signed in as ${email}. Display name, photo, and bio are visible in directory and chat.`
            : "Display name, photo, and bio are visible in directory and chat."
        }
      />
      <InfoCard
        title="Notifications"
        body="Set quiet hours and category-level push preferences for announcements, events, points, and tasks."
      />
      {/* The "revisit onboarding tutorial" entry left with
          `onboarding-tour.tsx`, which the first-run screen (s03) replaces
          (spec/ui/mobile/screens.md:58). */}
      <Pressable
        accessibilityRole="button"
        onPress={() => {
          void handleSignOut();
        }}
        style={styles.signOutButton}
      >
        <Text style={styles.signOutText}>Sign out</Text>
      </Pressable>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    signOutButton: {
      marginTop: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.destructive, 0.3),
      backgroundColor: tint(tokens.color.semantic.destructive),
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    signOutText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.destructive,
    },
  });
}
