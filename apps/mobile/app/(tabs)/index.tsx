import { ScreenShell } from "@/components/screen-shell";
import { FeedSummaryCard, TaskLoopCard } from "@/components/task-loop-card";

export default function HomeScreen() {
  return (
    <ScreenShell
      title="Activity Feed"
      subtitle="A unified chapter pulse with clear sync states, next actions, and high-signal updates."
    >
      <FeedSummaryCard
        balance="186 pts"
        rank="#4 chapter-wide"
        period="Month to date"
      />
      <TaskLoopCard
        category="Events"
        state="pending"
        title="Chapter Meeting check-in opens in 12 minutes"
        body="42 members confirmed. Role-targeted attendance will auto-award points after check-in."
        meta="Grace window: 15 minutes after start."
        actionHint="Open event and pre-check your attendance status."
      />
      <TaskLoopCard
        category="Announcements"
        state="synced"
        title="Exec dues timeline posted in #announcements"
        body="Leadership shared this week’s payment milestones and member outreach assignments."
        meta="Delivered to all members • 2 minutes ago"
      />
      <TaskLoopCard
        category="Backwork"
        state="cached"
        title="Rush Week Guide is available from cache"
        body="The latest document remains accessible while connectivity is unstable."
        meta="Last synced at 5:42 PM"
        actionHint="Reconnect to fetch newly uploaded revisions."
      />
      <TaskLoopCard
        category="Points"
        state="retry"
        title="One transaction failed to sync"
        body="Your +10 attendance award is queued and will retry automatically."
        meta="Auto-retry in 30 seconds"
        actionHint="Keep Frapp open or tap retry from My Points."
      />
    </ScreenShell>
  );
}
