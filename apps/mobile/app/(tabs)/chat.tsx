import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function ChatScreen() {
  return (
    <ScreenShell
      title="Chat"
      subtitle="Role-aware channels, announcements, and DMs built for chapter communication."
    >
      <InfoCard
        badge="Pinned"
        title="#announcements"
        body="Only officers can post. New posts notify all members."
      />
      <InfoCard
        title="Recent: #general"
        body="“Reminder: submit service hours before Sunday.”"
      />
      <InfoCard
        title="Message reliability"
        body="Outgoing messages will show sending, sent, or retry-needed states in low-connectivity conditions."
      />
    </ScreenShell>
  );
}
