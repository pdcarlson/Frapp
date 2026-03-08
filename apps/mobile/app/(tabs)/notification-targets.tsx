import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { frappTokens } from "@repo/theme/tokens";

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
          <Link key={target.label} href={target.route} asChild>
            <Pressable style={styles.targetRow}>
              <Text style={styles.targetLabel}>{target.label}</Text>
              <Text style={styles.targetDescription}>{target.description}</Text>
            </Pressable>
          </Link>
        ))}
      </View>

      <Link href="/notifications" asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to notifications</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: "#1E3A8A",
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.3,
    color: "#1E40AF",
  },
  summaryMeta: {
    fontSize: 13,
    color: "#1E3A8A",
  },
  targetList: {
    gap: 8,
  },
  targetRow: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  targetLabel: {
    fontSize: 15,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  targetDescription: {
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
