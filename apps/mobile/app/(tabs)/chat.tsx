import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";

export default function ChatScreen() {
  return (
    <ScreenShell
      title="Chat"
      subtitle="Role-aware channels with delivery state visibility for every message action."
    >
      <TaskLoopCard
        category="Pinned"
        state="synced"
        title="#announcements posting rules are active"
        body="Only officers can post. New messages are routed as chapter-wide notifications."
        meta="Permission gate: announcements:post"
      />
      <TaskLoopCard
        category="#general"
        state="pending"
        title="1 outgoing message is waiting for confirmation"
        body="“Reminder: submit service hours before Sunday.” will appear once server timestamp returns."
        meta="Queued locally • sent from unstable network"
      />
      <TaskLoopCard
        category="Direct message"
        state="retry"
        title="Delivery failed for one DM attachment"
        body="File upload paused when connection dropped. Retry is available without rewriting your message."
        meta="Retry attempts: 2 of 3"
        actionHint="Tap the failed message to resume upload."
      />
      <TaskLoopCard
        category="Presence"
        state="cached"
        title="Member online indicators are from cache"
        body="Live presence will refresh when heartbeat updates resume."
        meta="Last presence sync 48 seconds ago"
      />
    </ScreenShell>
  );
}
