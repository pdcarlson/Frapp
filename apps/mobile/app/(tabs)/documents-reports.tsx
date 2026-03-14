import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { FrappTokens } from "@repo/theme/tokens";
import { useFrappTheme } from "@/lib/theme";

export default function DocumentsReportsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  return (
    <ScreenShell
      title="Documents & Reports"
      subtitle="Backwork library health and export readiness for chapter operations."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Export readiness</Text>
        <Text style={styles.summaryValue}>3 reports available</Text>
        <Text style={styles.summaryMeta}>
          Attendance, points, and service CSV snapshots are current
        </Text>
      </View>

      <TaskLoopCard
        category="Backwork"
        state="synced"
        title="Rush Week packet is fully indexed"
        body="Newest PDF uploads are searchable and visible to assigned member roles."
        meta="Last index run: 8 minutes ago"
      />
      <TaskLoopCard
        category="Reports"
        state="pending"
        title="Monthly attendance export generating"
        body="CSV compilation is running after recent check-in updates."
        meta="Estimated completion: < 1 minute"
      />
      <TaskLoopCard
        category="Delivery"
        state="retry"
        title="PDF email dispatch failed"
        body="One report email could not be delivered and is queued for retry."
        meta="Retry policy active (2 of 4 attempts)"
        actionHint="Confirm recipient list before resending."
      />
      <TaskLoopCard
        category="Offline"
        state="cached"
        title="Recent reports available from cache"
        body="Last downloaded attendance and points reports can be reviewed offline."
        meta="Cached at 6:02 PM"
      />

      <Link href="/more" asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to more</Text>
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
