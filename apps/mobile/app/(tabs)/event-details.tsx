import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { FrappTokens } from "@repo/theme/tokens";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { exportEventToCalendar } from "@/lib/calendar-export";
import { useFrappTheme } from "@/lib/theme";

export default function EventDetailsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const [calendarState, setCalendarState] = useState<
    "ready" | "exporting" | "exported" | "failed"
  >("ready");

  async function handleCalendarExport() {
    setCalendarState("exporting");

    try {
      const exportStarted = await exportEventToCalendar({
        title: "Frapp Chapter Meeting",
        description:
          "Check-in window, role requirements, and chapter follow-up actions.",
        location: "Chapter House — Main Meeting Room",
        startAtIso: "2026-03-10T18:00:00-05:00",
        endAtIso: "2026-03-10T19:00:00-05:00",
        deepLinkUrl: "frapp://event-details",
      });

      setCalendarState(exportStarted ? "exported" : "failed");
    } catch {
      setCalendarState("failed");
    }
  }

  return (
    <ScreenShell
      title="Chapter Meeting"
      subtitle="Check-in window, role requirements, and calendar export readiness."
    >
      <View style={styles.summaryCard}>
        <Text style={styles.summaryLabel}>Check-in window</Text>
        <Text style={styles.summaryValue}>5:45 PM → 6:15 PM</Text>
        <Text style={styles.summaryMeta}>Required for Executive Board roles</Text>
      </View>

      <TaskLoopCard
        category="Calendar export"
        state={calendarState === "failed" ? "retry" : "synced"}
        title={
          calendarState === "exported"
            ? ".ics download started"
            : ".ics file is ready"
        }
        body={
          calendarState === "failed"
            ? "Calendar export could not start from this device context."
            : "Add this event to your device calendar with start/end, location, and Frapp deep link metadata."
        }
        meta={
          calendarState === "exported"
            ? "Calendar handoff started just now"
            : "Last exported: 2 minutes ago"
        }
      />
      <TaskLoopCard
        category="Attendance"
        state="pending"
        title="Self check-in queued for open window"
        body="Frapp will validate your role-targeted eligibility when the attendance window opens."
        meta="Window opens in 11 minutes"
      />
      <TaskLoopCard
        category="Resilience"
        state="cached"
        title="Event details available offline"
        body="Location, notes, and role requirements are cached to avoid losing context in low-connectivity venues."
        meta="Cached at 5:34 PM"
      />

      <Pressable
        accessibilityRole="button"
        accessibilityState={{ disabled: calendarState === "exporting" }}
        disabled={calendarState === "exporting"}
        onPress={() => {
          void handleCalendarExport();
        }}
        style={[
          styles.primaryButton,
          calendarState === "exporting" ? styles.primaryButtonDisabled : null,
        ]}
      >
        <Text style={styles.primaryButtonText}>
          {calendarState === "exporting"
            ? "Preparing calendar file..."
            : "Add to Calendar (.ics)"}
        </Text>
      </Pressable>
      {calendarState === "failed" ? (
        <Text style={styles.feedbackText}>
          Calendar export failed. Retry from a stable network connection.
        </Text>
      ) : null}
      <Link href="/events" asChild>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back to events</Text>
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
      color: tokens.color.feedback.infoTextStrong,
      letterSpacing: -0.3,
    },
    summaryMeta: {
      fontSize: 13,
      color: tokens.color.feedback.infoText,
    },
    primaryButton: {
      marginTop: 4,
      borderRadius: tokens.radius.md,
      backgroundColor: tokens.color.brand.royalBlue,
      paddingVertical: 12,
      alignItems: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: tokens.color.text.inverse,
    },
    feedbackText: {
      marginTop: 6,
      fontSize: 12,
      color: tokens.color.feedback.errorText,
    },
    secondaryButton: {
      borderRadius: tokens.radius.md,
      borderWidth: 1,
      borderColor: tokens.color.surface.border,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: 12,
      alignItems: "center",
    },
    secondaryButtonText: {
      fontSize: 14,
      fontWeight: "700",
      color: tokens.color.text.primary,
    },
  });
}
