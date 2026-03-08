import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";

export default function NotificationsScreen() {
  return (
    <ScreenShell
      title="Notification Center"
      subtitle="Unread activity, delivery priority, and deep-link readiness across chapter workflows."
    >
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
