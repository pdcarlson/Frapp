import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s02 — Join chapter (spec/ui/mobile/screens.md:23): code entry plus
 * invite-link autofill.
 *
 * TODO-DESIGN: pre-registered by S2 (#957) so the route exists and the
 * `(auth)` stack is complete. The drawn screen is NOT built here, and no
 * C-cluster in #937 currently owns it — tracked as a follow-up so it does not
 * orphan. The chapter picker deliberately reuses this screen's card language.
 */
export default function JoinChapter() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const router = useRouter();

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Join a chapter</Text>
      <Text style={styles.subtitle}>
        Enter the invite code your chapter gave you. Not built yet — open an
        invite link to join for now.
      </Text>
      <Pressable
        accessibilityRole="button"
        accessibilityHint="Open the first-officer chapter creation wizard."
        onPress={() => {
          router.push("/create-chapter");
        }}
        style={styles.createButton}
      >
        <Text style={styles.createButtonText}>Create a chapter</Text>
      </Pressable>
    </View>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: "center",
      padding: tokens.spacing.xl,
      backgroundColor: tokens.color.surface.background,
    },
    title: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    subtitle: {
      marginTop: tokens.spacing.xs,
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    createButton: {
      marginTop: tokens.spacing.lg,
      borderRadius: tokens.radius.control,
      backgroundColor: tokens.color.gold.house,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    createButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.gold.onHouse,
    },
  });
}
