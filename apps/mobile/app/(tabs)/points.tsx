import { Link } from "expo-router";
import { Pressable, StyleSheet, Text } from "react-native";
import { ScreenShell } from "@/components/screen-shell";
import { frappTokens } from "@repo/theme/tokens";
import { FeedSummaryCard, TaskLoopCard } from "@/components/task-loop-card";

function PointsNavTile({
  href,
  title,
  subtitle,
}: {
  href: "/points-details";
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

export default function PointsScreen() {
  return (
    <ScreenShell
      title="My Points"
      subtitle="Track your balance, transaction sync health, and leaderboard momentum."
    >
      <PointsNavTile
        href="/points-details"
        title="Open leaderboard details"
        subtitle="Switch time windows and inspect top chapter ranks."
      />
      <FeedSummaryCard
        balance="186 pts"
        rank="#4 chapter-wide"
        period="All time"
      />
      <TaskLoopCard
        category="Recent award"
        state="synced"
        title="+10 attendance • Chapter Meeting"
        body="Awarded today at 6:52 PM and reflected in your running balance."
        meta="Source: event check-in automation"
      />
      <TaskLoopCard
        category="Adjustment"
        state="pending"
        title="Manual adjustment under review"
        body="+3 service bonus is awaiting admin confirmation before it finalizes."
        meta="Expected completion: tonight"
      />
      <TaskLoopCard
        category="Sync health"
        state="retry"
        title="Leaderboard refresh failed"
        body="Your last leaderboard request timed out and is retrying in the background."
        meta="Retry policy: 3 attempts with backoff"
        actionHint="Pull to refresh when connectivity improves."
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
