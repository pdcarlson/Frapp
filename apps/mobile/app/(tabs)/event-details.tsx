import { Pressable, StyleSheet, Text, View } from "react-native";
import { Link } from "expo-router";
import { frappTokens } from "@repo/theme/tokens";
import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";

export default function EventDetailsScreen() {
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
        state="synced"
        title=".ics file is ready"
        body="Add this event to your device calendar with start/end, location, and Frapp deep link metadata."
        meta="Last exported: 2 minutes ago"
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

      <Pressable style={styles.primaryButton}>
        <Text style={styles.primaryButtonText}>Add to Calendar (.ics)</Text>
      </Pressable>
      <Link href="/events" asChild>
        <Pressable style={styles.secondaryButton}>
          <Text style={styles.secondaryButtonText}>Back to events</Text>
        </Pressable>
      </Link>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  summaryCard: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: "#BFDBFE",
    backgroundColor: "#EFF6FF",
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  summaryLabel: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
    color: "#1E3A8A",
  },
  summaryValue: {
    fontSize: 22,
    fontWeight: "800",
    color: "#1E40AF",
    letterSpacing: -0.3,
  },
  summaryMeta: {
    fontSize: 13,
    color: "#1E3A8A",
  },
  primaryButton: {
    marginTop: 4,
    borderRadius: frappTokens.radius.md,
    backgroundColor: frappTokens.color.brand.royalBlue,
    paddingVertical: 12,
    alignItems: "center",
  },
  primaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: frappTokens.color.text.inverse,
  },
  secondaryButton: {
    borderRadius: frappTokens.radius.md,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    paddingVertical: 12,
    alignItems: "center",
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
});
