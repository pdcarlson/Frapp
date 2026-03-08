import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function NotificationsScreen() {
  return (
    <ScreenShell
      title="Notification Center"
      subtitle="Unread activity and chapter alerts with direct navigation targets."
    >
      <InfoCard
        badge="Unread"
        title="Event reminder • Chapter Meeting in 1 hour"
        body="Tap to open event details and attendance checklist."
      />
      <InfoCard
        badge="Unread"
        title="Announcement posted in #announcements"
        body="Leadership posted dues timeline updates for this week."
      />
      <InfoCard
        title="Notification categories"
        body="Chat mentions, events, points, tasks, and service approvals can be independently managed in Preferences."
      />
    </ScreenShell>
  );
}
