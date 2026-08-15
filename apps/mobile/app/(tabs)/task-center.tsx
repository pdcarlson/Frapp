import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

export default function TaskCenterScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

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

      <Link href={asRoute("/more")} asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to more</Text>
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
