import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { FrappTokens } from "@repo/theme/tokens";
import { useFrappTheme } from "@/lib/theme";

const TARGETS = [
  {
    label: "Event reminder",
    route: "/event-details",
    description: "Opens attendance/check-in details for the targeted event.",
  },
  {
    label: "Announcement update",
    route: "/chat-thread",
    description: "Opens the relevant channel thread with unread context.",
  },
  {
    label: "Points change",
    route: "/points-details",
    description: "Opens leaderboard and transaction reliability details.",
  },
  {
    label: "Task due/overdue",
    route: "/task-center",
    description: "Opens assigned tasks and confirmation states.",
  },
] as const;

export default function NotificationTargetsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <ScreenShell
      title="Notification Destinations"
      subtitle="Validate deep-link mapping so every notification opens the intended workflow."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Routing contract</Text>
        <Text style={styles.summaryValue}>4 primary destinations</Text>
        <Text style={styles.summaryMeta}>
          Auth handoff should return users to these targets after sign-in.
        </Text>
      </View>

      <View style={styles.targetList}>
        {TARGETS.map((target) => (
          <Link key={target.label} href={asRoute(target.route)} asChild>
            <Pressable style={styles.targetRow}>
              <Text style={styles.targetLabel}>{target.label}</Text>
              <Text style={styles.targetDescription}>{target.description}</Text>
            </Pressable>
          </Link>
        ))}
      </View>

      <Link href={asRoute("/notifications")} asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to notifications</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    summaryCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.feedback.infoBorder,
      backgroundColor: tokens.color.feedback.infoBackground,
      padding: tokens.spacing.lg,
      gap: 6,
    },
    summaryLabel: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.feedback.infoText,
    },
    summaryValue: {
      fontSize: 22,
      fontWeight: "800",
      letterSpacing: -0.3,
      color: tokens.color.feedback.infoTextStrong,
    },
    summaryMeta: {
      fontSize: 13,
      color: tokens.color.feedback.infoText,
    },
    targetList: {
      gap: 8,
    },
    targetRow: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 6,
    },
    targetLabel: {
      fontSize: 15,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    targetDescription: {
      fontSize: 14,
      lineHeight: 20,
      color: tokens.color.text.secondary,
    },
    backButton: {
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: 12,
      alignItems: "center",
    },
    backButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
  });
}
