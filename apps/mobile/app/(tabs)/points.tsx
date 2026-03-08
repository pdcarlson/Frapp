import { ScreenShell } from "@/components/screen-shell";
import { NavTile } from "@/components/nav-tile";
import { FeedSummaryCard, TaskLoopCard } from "@/components/task-loop-card";

export default function PointsScreen() {
  return (
    <ScreenShell
      title="My Points"
      subtitle="Track your balance, transaction sync health, and leaderboard momentum."
    >
      <NavTile
        href="/points-details"
        title="Open leaderboard details"
        description="Switch time windows and inspect top chapter ranks."
        accessibilityHint="Open leaderboard detail and time-window controls."
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
