import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

const ONBOARDING_STEPS = [
  {
    title: "Welcome to Frapp",
    detail:
      "Understand chapter expectations, notification priorities, and where daily updates live.",
  },
  {
    title: "Chat foundations",
    detail:
      "Learn how channel permissions, announcement rules, and message reliability states work.",
  },
  {
    title: "Events and attendance",
    detail:
      "See check-in windows, grace periods, and calendar export actions before your first meeting.",
  },
  {
    title: "Backwork access",
    detail:
      "Find chapter documents quickly with role-aware visibility and offline fallback guidance.",
  },
  {
    title: "Study and service loops",
    detail:
      "Understand how session tracking and service approvals convert into chapter points.",
  },
  {
    title: "Profile and preferences",
    detail:
      "Set quiet hours and communication defaults to match your routine.",
  },
  {
    title: "You’re ready",
    detail:
      "Review key actions for your first week and revisit this tutorial from Profile anytime.",
  },
];

export default function OnboardingTourScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <ScreenShell
      title="Onboarding Tutorial"
      subtitle="A guided preview of the first-launch journey for new chapter members."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Tutorial structure</Text>
        <Text style={styles.summaryValue}>7 guided steps</Text>
        <Text style={styles.summaryMeta}>
          Swipeable cards on mobile app launch • modal walkthrough on web
        </Text>
      </View>

      <View style={styles.stepList}>
        {ONBOARDING_STEPS.map((step, index) => (
          <View key={step.title} style={styles.stepCard}>
            <View style={styles.stepHeader}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>Step {index + 1}</Text>
              </View>
              <Text style={styles.stepTitle}>{step.title}</Text>
            </View>
            <Text style={styles.stepDetail}>{step.detail}</Text>
          </View>
        ))}
      </View>

      <Link href={asRoute("/profile")} asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to profile</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    summaryCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.info, 0.3),
      backgroundColor: tint(tokens.color.semantic.info),
      padding: tokens.spacing.lg,
      gap: tokens.spacing.xs,
    },
    summaryLabel: {
      ...typeRole(tokens.typography.role.label),
      textTransform: "uppercase",
      letterSpacing: 0.3,
      color: tokens.color.semantic.info,
    },
    summaryValue: {
      ...typeRole(tokens.typography.role.headline),
      letterSpacing: -0.3,
      color: tokens.color.text.foreground,
    },
    summaryMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.info,
    },
    stepList: {
      gap: tokens.spacing.sm,
    },
    stepCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    stepHeader: {
      gap: tokens.spacing.xs,
    },
    stepBadge: {
      alignSelf: "flex-start",
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tint(tokens.color.semantic.info, 0.3),
      backgroundColor: tint(tokens.color.semantic.info),
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: 3,
    },
    stepBadgeText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.info,
      textTransform: "uppercase",
    },
    stepTitle: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    stepDetail: {
      ...typeRole(tokens.typography.role.body),
      color: tokens.color.text.mutedForeground,
    },
    backButton: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    backButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
