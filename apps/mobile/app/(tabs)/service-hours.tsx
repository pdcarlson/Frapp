import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { frappTokens } from "@repo/theme/tokens";

export default function ServiceHoursScreen() {
  return (
    <ScreenShell
      title="Service Hours"
      subtitle="Log philanthropy work, monitor approval outcomes, and track awarded points."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Approved this semester</Text>
        <Text style={styles.summaryValue}>18.5 hrs</Text>
        <Text style={styles.summaryMeta}>
          Chapter rank #6 • 2 entries pending review
        </Text>
      </View>

      <TaskLoopCard
        category="Pending review"
        state="pending"
        title="Food bank volunteer shift"
        body="2h 30m submission is awaiting admin approval with proof attachment."
        meta="Submitted today at 4:12 PM"
      />
      <TaskLoopCard
        category="Approved"
        state="synced"
        title="Campus cleanup day"
        body="Entry approved and points awarded at chapter service rate."
        meta="Awarded: +3 points"
      />
      <TaskLoopCard
        category="Upload"
        state="retry"
        title="Proof upload failed on weak signal"
        body="Receipt photo is queued for retry and your draft entry is still intact."
        meta="Retry 1 of 3"
        actionHint="Keep app in foreground until upload completes."
      />
      <TaskLoopCard
        category="History"
        state="cached"
        title="Service log available offline"
        body="Recent entries remain visible while you are away from connectivity."
        meta="Last sync: 5:28 PM"
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
