import { Link, useRouter } from "expo-router";
import { asRoute } from "@/lib/href";
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
      <Link href={asRoute("/onboarding-tour")} asChild>
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
    tutorialButton: {
      marginTop: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.info, 0.3),
      backgroundColor: tint(tokens.color.semantic.info),
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    tutorialText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.semantic.info,
    },
  });
}
