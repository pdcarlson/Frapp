import { ScreenShell } from "@/components/screen-shell";
import { NavTile } from "@/components/nav-tile";
import { TaskLoopCard } from "@/components/task-loop-card";

export default function NotificationsScreen() {
  return (
    <ScreenShell
      title="Notification Center"
      subtitle="Unread activity, delivery priority, and deep-link readiness across chapter workflows."
    >
      <NavTile
        href="/notification-targets"
        title="Open deep-link destination map"
        description="Preview where event, chat, points, and task notifications route."
        accessibilityHint="Open notification deep-link destination preview."
      />
      <TaskLoopCard
        category="Events"
        state="synced"
        title="Chapter Meeting reminder delivered"
        body="Tap to open event details and attendance checklist."
        meta="Priority: NORMAL • 1 hour before start"
      />
      <TaskLoopCard
        category="Announcements"
        state="pending"
        title="3 unread posts in #announcements"
        body="Leadership posted dues timeline updates and role-specific tasks."
        meta="Grouped notification bundle"
      />
      <TaskLoopCard
        category="Delivery"
        state="cached"
        title="Quiet-hours badge updates cached"
        body="Badge totals continue updating even when sound/vibration notifications are suppressed."
        meta="Last full sync: 4 minutes ago"
      />
      <TaskLoopCard
        category="Failure"
        state="retry"
        title="One push receipt failed"
        body="Frapp will retry this send and keep the alert visible in-app."
        meta="Auto-retry policy active"
      />
    </ScreenShell>
  );
}
