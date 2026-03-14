import { Link } from "expo-router";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { FrappTokens } from "@repo/theme/tokens";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { useMemo, useState } from "react";
import { useFrappTheme } from "@/lib/theme";

type LeaderboardWindow = "all-time" | "semester" | "month";

const WINDOW_OPTIONS: Array<{ key: LeaderboardWindow; label: string }> = [
  { key: "all-time", label: "All time" },
  { key: "semester", label: "Semester" },
  { key: "month", label: "Month" },
];

const LEADERBOARD_ROWS_BY_WINDOW: Record<
  LeaderboardWindow,
  Array<{ rank: string; member: string; points: string }>
> = {
  "all-time": [
    { rank: "#1", member: "Jordan M.", points: "332 pts" },
    { rank: "#2", member: "Evan R.", points: "318 pts" },
    { rank: "#3", member: "Dylan P.", points: "295 pts" },
    { rank: "#4", member: "You", points: "286 pts" },
  ],
  semester: [
    { rank: "#1", member: "You", points: "94 pts" },
    { rank: "#2", member: "Jordan M.", points: "90 pts" },
    { rank: "#3", member: "Dylan P.", points: "88 pts" },
    { rank: "#4", member: "Evan R.", points: "81 pts" },
  ],
  month: [
    { rank: "#1", member: "You", points: "42 pts" },
    { rank: "#2", member: "Jordan M.", points: "40 pts" },
    { rank: "#3", member: "Evan R.", points: "36 pts" },
    { rank: "#4", member: "Dylan P.", points: "35 pts" },
  ],
};

export default function PointsDetailsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [selectedWindow, setSelectedWindow] =
    useState<LeaderboardWindow>("all-time");
  const leaderboardRows = useMemo(
    () => LEADERBOARD_ROWS_BY_WINDOW[selectedWindow],
    [selectedWindow],
  );

  return (
    <ScreenShell
      title="Leaderboard Details"
      subtitle="Compare chapter rankings by time window and inspect transaction reliability."
    >
      <View style={styles.windowCard}>
        <Text style={styles.windowLabel}>Time window</Text>
        <View style={styles.windowButtonRow}>
          {WINDOW_OPTIONS.map((windowOption) => {
            const active = selectedWindow === windowOption.key;

            return (
              <Pressable
                key={windowOption.key}
                accessibilityRole="button"
                accessibilityState={{ selected: active }}
                onPress={() => setSelectedWindow(windowOption.key)}
                style={[
                  styles.windowButton,
                  active ? styles.windowButtonActive : null,
                ]}
              >
                <Text
                  style={[
                    styles.windowButtonText,
                    active ? styles.windowButtonTextActive : null,
                  ]}
                >
                  {windowOption.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={styles.tableCard}>
        <Text style={styles.tableTitle}>
          Top chapter ranks ·{" "}
          {WINDOW_OPTIONS.find((windowOption) => windowOption.key === selectedWindow)
            ?.label ?? "All time"}
        </Text>
        <View style={styles.tableRows}>
          {leaderboardRows.map((row) => (
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
        state={selectedWindow === "month" ? "pending" : "synced"}
        title={
          selectedWindow === "month"
            ? "Month window recomputing"
            : "Selected window synchronized"
        }
        body={
          selectedWindow === "month"
            ? "Current period leaderboard is refreshing in the background after recent check-ins."
            : "Leaderboard data is in sync with the selected time window."
        }
        meta={
          selectedWindow === "month"
            ? "Estimated refresh: < 30s"
            : "Switch windows to inspect period-level rankings."
        }
      />

      <Link href="/points" asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to points overview</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function createStyles(tokens: FrappTokens) {
  return StyleSheet.create({
    windowCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 10,
    },
    windowLabel: {
      fontSize: 12,
      fontWeight: "700",
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    windowButtonRow: {
      flexDirection: "row",
      gap: 8,
    },
    windowButton: {
      flex: 1,
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.muted,
      paddingVertical: 9,
      alignItems: "center",
    },
    windowButtonActive: {
      backgroundColor: tokens.color.feedback.infoBackgroundStrong,
      borderColor: tokens.color.feedback.infoBorderStrong,
    },
    windowButtonText: {
      fontSize: 13,
      fontWeight: "700",
      color: tokens.color.text.secondary,
    },
    windowButtonTextActive: {
      color: tokens.color.feedback.infoTextInteractive,
    },
    tableCard: {
      borderRadius: tokens.radius.lg,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: 8,
    },
    tableTitle: {
      fontSize: 15,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    tableRows: {
      gap: 6,
    },
    tableRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.muted,
      paddingHorizontal: 10,
      paddingVertical: 8,
      gap: 8,
    },
    rankCell: {
      width: 34,
      fontSize: 13,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
    memberCell: {
      flex: 1,
      fontSize: 13,
      fontWeight: "600",
      color: tokens.color.text.primary,
    },
    pointsCell: {
      fontSize: 13,
      fontWeight: "700",
      color: tokens.color.brand.royalBlue,
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
