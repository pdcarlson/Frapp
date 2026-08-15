import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { useMemo, useState } from "react";
import { useChapterBranding } from "@/lib/chapter-branding";
import { MONO_FONT_FAMILY, tint, typeRole, useFrappTheme } from "@/lib/theme";

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
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
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
          {WINDOW_OPTIONS.find(
            (windowOption) => windowOption.key === selectedWindow,
          )?.label ?? "All time"}
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

      <Link href={asRoute("/points")} asChild>
        <Pressable style={styles.backButton}>
          <Text style={styles.backButtonText}>Back to points overview</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    windowCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    windowLabel: {
      ...typeRole(tokens.typography.role.label),
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    windowButtonRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    windowButton: {
      flex: 1,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingVertical: tokens.spacing.sm,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    windowButtonActive: {
      backgroundColor: tint(tokens.color.semantic.info),
      borderColor: tint(tokens.color.semantic.info, 0.3),
    },
    windowButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.mutedForeground,
    },
    windowButtonTextActive: {
      color: tokens.color.semantic.info,
    },
    tableCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    tableTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    tableRows: {
      gap: tokens.spacing.xs,
    },
    tableRow: {
      flexDirection: "row",
      alignItems: "center",
      borderRadius: tokens.radius.chipLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.surface1,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.sm,
      gap: tokens.spacing.sm,
    },
    rankCell: {
      width: 34,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    memberCell: {
      flex: 1,
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    // Points cells are a mono role (foundations.md §7): mono takes the size of
    // the role it sits in, with the system mono stack, never a bundled font.
    pointsCell: {
      fontSize: tokens.typography.role.label.size,
      fontFamily: MONO_FONT_FAMILY,
      fontWeight: "700",
      color: accent,
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
