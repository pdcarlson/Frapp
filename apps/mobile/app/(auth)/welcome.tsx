import { StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s03 — First-run + notification primer (spec/ui/mobile/screens.md:24):
 * auto-joined channels plus the contextual push primer.
 *
 * TODO-DESIGN: pre-registered by S2 (#957). The push primer this screen hosts
 * belongs to cluster C7 (which owns push), but nothing in #937 owns the
 * first-run screen around it — tracked as a follow-up.
 *
 * Replaces the deleted `onboarding-tour.tsx` (screens.md:58).
 */
export default function Welcome() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome</Text>
      <Text style={styles.subtitle}>
        You have been added to your chapter&apos;s channels. Not built yet.
      </Text>
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
  });
}
