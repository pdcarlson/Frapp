import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { frappTokens } from "@repo/theme/tokens";

export default function TaskCenterScreen() {
  return (
    <ScreenShell
      title="Task Center"
      subtitle="Assigned work, completion status, and admin confirmation states."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>My task load</Text>
        <Text style={styles.summaryValue}>4 active tasks</Text>
        <Text style={styles.summaryMeta}>
          1 due today • 1 awaiting confirmation
        </Text>
      </View>

      <TaskLoopCard
        category="Due today"
        state="pending"
        title="Prepare chapter room setup checklist"
        body="Task is marked IN_PROGRESS and due at 5:30 PM today."
        meta="Assigned by Operations Chair"
      />
      <TaskLoopCard
        category="Confirmation"
        state="synced"
        title="Service recap deck approved"
        body="Admin confirmed completion and reward points were posted to your ledger."
        meta="Reward: +8 points"
      />
      <TaskLoopCard
        category="Overdue"
        state="retry"
        title="Community outreach follow-ups"
        body="Task slipped past due date and reminder notifications are retrying."
        meta="Overdue by 1 day"
        actionHint="Send status update in #operations."
      />
      <TaskLoopCard
        category="Offline"
        state="cached"
        title="Task notes draft stored locally"
        body="Your completion notes remain safe offline and will sync when connected."
        meta="Last local save: 3 minutes ago"
      />

      <Link href="/more" asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to more</Text>
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
