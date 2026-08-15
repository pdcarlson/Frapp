import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

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
      letterSpacing: 0.3,
      textTransform: "uppercase",
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
    targetList: {
      gap: tokens.spacing.sm,
    },
    targetRow: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.xs,
      minHeight: tokens.touch.minimum,
    },
    targetLabel: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    targetDescription: {
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
