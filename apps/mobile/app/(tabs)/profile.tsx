import { Link, useRouter } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FrappTokens } from "@repo/theme/tokens";
import { InfoCard, ScreenShell } from "@/components/screen-shell";
import { usePreviewSession } from "@/lib/preview-session";
import { ThemePreference, useFrappTheme } from "@/lib/theme";

const THEME_OPTIONS: Array<{ key: ThemePreference; label: string }> = [
  { key: "system", label: "System" },
  { key: "light", label: "Light" },
  { key: "dark", label: "Dark" },
];

export default function ProfileScreen() {
  const router = useRouter();
  const { signOut } = usePreviewSession();
  const { themePreference, resolvedTheme, setThemePreference, tokens } =
    useFrappTheme();
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
        body="Display name, photo, and bio are visible in directory and chat."
      />
      <InfoCard
        title="Notifications"
        body="Set quiet hours and category-level push preferences for announcements, events, points, and tasks."
      />
      <View style={styles.themeCard}>
        <Text style={styles.themeTitle}>Theme mode</Text>
        <Text style={styles.themeBody}>
          Manual override applies immediately. Current resolved mode:{" "}
          {resolvedTheme === "dark" ? "Dark" : "Light"}.
        </Text>
        <View style={styles.themeOptionRow}>
          {THEME_OPTIONS.map((themeOption) => {
            const selected = themePreference === themeOption.key;
            return (
              <Pressable
                key={themeOption.key}
                accessibilityRole="button"
                accessibilityState={{ selected }}
                onPress={() => setThemePreference(themeOption.key)}
                style={[
                  styles.themeOptionButton,
                  selected ? styles.themeOptionButtonActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.themeOptionText,
                    selected ? styles.themeOptionTextActive : null,
                  ]}
                >
                  {themeOption.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>
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
        <Text style={styles.signOutText}>Sign out of preview session</Text>
      </Pressable>
    </ScreenShell>
  );
}

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    themeCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 8,
    },
    themeTitle: {
      fontSize: tokens.type.section - 2,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    themeBody: {
      fontSize: tokens.type.body - 1,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
    themeOptionRow: {
      marginTop: 4,
      flexDirection: "row",
      gap: 8,
    },
    themeOptionButton: {
      flex: 1,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.muted,
      paddingVertical: 9,
      alignItems: "center",
    },
    themeOptionButtonActive: {
      borderColor: tokens.color.feedback.infoBorderStrong,
      backgroundColor: tokens.color.feedback.infoBackgroundStrong,
    },
    themeOptionText: {
      fontSize: 13,
      fontWeight: "700",
      color: tokens.color.text.secondary,
    },
    themeOptionTextActive: {
      color: tokens.color.feedback.infoTextInteractive,
    },
    signOutButton: {
      marginTop: 4,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.feedback.errorBorder,
      backgroundColor: tokens.color.feedback.errorBackground,
      paddingVertical: 12,
      alignItems: "center",
    },
    signOutText: {
      fontSize: 14,
      fontWeight: "700",
      color: tokens.color.feedback.errorText,
    },
    tutorialButton: {
      marginTop: 4,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.feedback.infoBorder,
      backgroundColor: tokens.color.feedback.infoBackground,
      paddingVertical: 12,
      alignItems: "center",
    },
    tutorialText: {
      fontSize: 14,
      fontWeight: "700",
      color: tokens.color.feedback.infoTextInteractive,
    },
  });
}
