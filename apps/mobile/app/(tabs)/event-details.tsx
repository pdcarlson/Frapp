import { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { asRoute } from "@/lib/href";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";
import { exportEventToCalendar } from "@/lib/calendar-export";
import { useChapterBranding } from "@/lib/chapter-branding";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

export default function EventDetailsScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
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
        <Text style={styles.summaryMeta}>
          Required for Executive Board roles
        </Text>
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
      <Link href={asRoute("/events")} asChild>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back to events</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
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
      letterSpacing: 0.3,
      textTransform: "uppercase",
      color: tokens.color.semantic.info,
    },
    summaryValue: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
      letterSpacing: -0.3,
    },
    summaryMeta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.info,
    },
    primaryButton: {
      marginTop: tokens.spacing.xs,
      borderRadius: tokens.radius.control,
      backgroundColor: accent,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.button,
      alignItems: "center",
      justifyContent: "center",
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      // Chapter accents clear AA against the dark card, so the darkest surface
      // step is the legible on-accent text until the engine's on-primary lands.
      color: tokens.color.surface.background,
    },
    feedbackText: {
      marginTop: tokens.spacing.xs,
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.semantic.destructive,
    },
    secondaryButton: {
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      paddingVertical: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
  });
}
