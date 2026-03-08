import { Link } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { frappTokens } from "@repo/theme/tokens";
import { TaskLoopCard } from "@/components/task-loop-card";

function EventNavTile({
  href,
  title,
  subtitle,
}: {
  href: "/event-details";
  title: string;
  subtitle: string;
}) {
  return (
    <Link href={href} asChild>
      <Pressable style={styles.navTile}>
        <Text style={styles.navTileTitle}>{title}</Text>
        <Text style={styles.navTileSubtitle}>{subtitle}</Text>
      </Pressable>
    </Link>
  );
}

export default function EventsScreen() {
  return (
    <ScreenShell
      title="Events"
      subtitle="Upcoming windows, check-in eligibility, and recovery states when connectivity degrades."
    >
      <EventNavTile
        href="/event-details"
        title="Open Chapter Meeting details"
        subtitle="View check-in rules, role targeting, and calendar export status."
      />
      <TaskLoopCard
        category="Today"
        state="pending"
        title="Chapter Meeting • 6:00 PM"
        body="Check-in opens 15 minutes before start and closes 15 minutes after end."
        meta="Mandatory for executive board"
        actionHint="Open details to verify your role requirement."
      />
      <TaskLoopCard
        category="Saturday"
        state="synced"
        title="Philanthropy Showcase"
        body="Optional attendance • 15 points available for successful check-in."
        meta="Calendar export is ready"
      />
      <TaskLoopCard
        category="Check-in"
        state="cached"
        title="Offline check-in receipt stored locally"
        body="If the API is unreachable, Frapp stores your check-in and resubmits automatically."
        meta="Pending submissions: 1"
        actionHint="Stay online until you see a synced state."
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  navTile: {
    borderRadius: frappTokens.radius.lg,
    borderWidth: 1,
    borderColor: frappTokens.color.surface.border,
    backgroundColor: frappTokens.color.surface.card,
    padding: frappTokens.spacing.lg,
    gap: 6,
  },
  navTileTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: frappTokens.color.text.primary,
  },
  navTileSubtitle: {
    fontSize: 14,
    lineHeight: 20,
    color: frappTokens.color.text.secondary,
  },
});
