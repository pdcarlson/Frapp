import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { frappTokens } from "@repo/theme/tokens";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";

const LEADERBOARD_ROWS = [
  { rank: "#1", member: "Jordan M.", points: "332 pts" },
  { rank: "#2", member: "Evan R.", points: "318 pts" },
  { rank: "#3", member: "Dylan P.", points: "295 pts" },
  { rank: "#4", member: "You", points: "286 pts" },
];

export default function PointsDetailsScreen() {
  return (
    <ScreenShell
      title="Leaderboard Details"
      subtitle="Compare chapter rankings by time window and inspect transaction reliability."
    >
      <View style={styles.windowCard}>
        <Text style={styles.windowLabel}>Time window</Text>
        <View style={styles.windowButtonRow}>
          <Pressable style={[styles.windowButton, styles.windowButtonActive]}>
            <Text style={[styles.windowButtonText, styles.windowButtonTextActive]}>
              All time
            </Text>
          </Pressable>
          <Pressable style={styles.windowButton}>
            <Text style={styles.windowButtonText}>Semester</Text>
          </Pressable>
          <Pressable style={styles.windowButton}>
            <Text style={styles.windowButtonText}>Month</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.tableCard}>
        <Text style={styles.tableTitle}>Top chapter ranks</Text>
        <View style={styles.tableRows}>
          {LEADERBOARD_ROWS.map((row) => (
            <View key={row.rank} style={styles.tableRow}>
              <Text style={styles.rankCell}>{row.rank}</Text>
              <Text style={styles.memberCell}>{row.member}</Text>
              <Text style={styles.pointsCell}>{row.points}</Text>
            </View>
          ))}
        </View>
      </View>

      <TaskLoopCard
        category="Audit"
        state="synced"
        title="Manual adjustments include full reason trail"
        body="Every admin adjustment remains append-only with attribution for review confidence."
        meta="Anomaly threshold alerts active"
      />
      <TaskLoopCard
        category="Refresh"
        state="pending"
        title="Month window recomputing"
        body="Current period leaderboard is refreshing in the background after recent check-ins."
        meta="Estimated refresh: < 30s"
      />

      <Link href="/points" asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to points overview</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  windowCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 10,
  },
  windowLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: frappTokens.color.text.muted,
  },
  windowButtonRow: {
    flexDirection: "row",
    gap: 8,
  },
  windowButton: {
    flex: 1,
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.muted,
    paddingVertical: 9,
    alignItems: "center",
  },
  windowButtonActive: {
    backgroundColor: frappTokens.color.feedback.infoBackgroundStrong,
    borderColor: frappTokens.color.feedback.infoBorderStrong,
  },
  windowButtonText: {
    fontSize: 13,
    fontWeight: "700",
    color: frappTokens.color.text.secondary,
  },
  windowButtonTextActive: {
    color: frappTokens.color.feedback.infoTextInteractive,
  },
  tableCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 8,
  },
  tableTitle: {
    fontSize: 15,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  tableRows: {
    gap: 6,
  },
  tableRow: {
    flexDirection: "row",
    alignItems: "center",
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.muted,
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 8,
  },
  rankCell: {
    width: 34,
    fontSize: 13,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  memberCell: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
    color: frappTokens.color.text.primary,
  },
  pointsCell: {
    fontSize: 13,
    fontWeight: "700",
    color: frappTokens.color.brand.royalBlue,
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
