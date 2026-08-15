import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { SignetTokens } from "@repo/theme/signet";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

export default function ServiceHoursScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

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
