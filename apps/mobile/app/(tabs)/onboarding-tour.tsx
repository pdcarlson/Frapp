import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { frappTokens } from "@repo/theme/tokens";

const ONBOARDING_STEPS = [
  {
    title: "Welcome to Frapp",
    detail: "Understand chapter expectations, notification priorities, and where daily updates live.",
  },
  {
    title: "Chat foundations",
    detail: "Learn how channel permissions, announcement rules, and message reliability states work.",
  },
  {
    title: "Events and attendance",
    detail: "See check-in windows, grace periods, and calendar export actions before your first meeting.",
  },
  {
    title: "Backwork access",
    detail: "Find chapter documents quickly with role-aware visibility and offline fallback guidance.",
  },
  {
    title: "Study and service loops",
    detail: "Understand how session tracking and service approvals convert into chapter points.",
  },
  {
    title: "Profile and preferences",
    detail: "Set quiet hours, theme mode, and communication defaults to match your routine.",
  },
  {
    title: "You’re ready",
    detail: "Review key actions for your first week and revisit this tutorial from Profile anytime.",
  },
];

export default function OnboardingTourScreen() {
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

      <Link href="/profile" asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to profile</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.infoBorder,
    backgroundColor: frappTokens.color.feedback.infoBackground,
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.3,
    color: frappTokens.color.feedback.infoText,
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: frappTokens.color.feedback.infoTextStrong,
  },
  summaryMeta: {
    fontSize: 13,
    color: frappTokens.color.feedback.infoText,
  },
  stepList: {
    gap: 8,
  },
  stepCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 8,
  },
  stepHeader: {
    gap: 6,
  },
  stepBadge: {
    alignSelf: "flex-start",
    borderRadius: 999,
    borderWidth: 1,
    borderColor: frappTokens.color.feedback.infoBorderStrong,
    backgroundColor: frappTokens.color.feedback.infoBackgroundStrong,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  stepBadgeText: {
    fontSize: 11,
    fontWeight: "700",
    color: frappTokens.color.feedback.infoTextInteractive,
    textTransform: "uppercase",
  },
  stepTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  stepDetail: {
    fontSize: 14,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
  },
  backButton: {
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    paddingVertical: 12,
    alignItems: "center",
  },
  backButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
});
