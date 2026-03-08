import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";

export default function PreferencesScreen() {
  return (
    <ScreenShell
      title="Preferences"
      subtitle="Control communication defaults and confirm whether each preference has synced."
    >
      <TaskLoopCard
        category="Quiet hours"
        state="synced"
        title="10:00 PM → 8:00 AM"
        body="Normal-priority notifications are delivered silently during this window."
        meta="Timezone: America/New_York"
      />
      <TaskLoopCard
        category="Category controls"
        state="pending"
        title="DM preference update queued"
        body="Your latest DM alert toggle is waiting for a stable network to sync."
        meta="Will retry automatically"
      />
      <TaskLoopCard
        category="Theme"
        state="cached"
        title="System mode active"
        body="Frapp follows your device appearance and keeps the last known mode offline."
        meta="Last confirmed sync: today"
      />
      <TaskLoopCard
        category="Integrity"
        state="retry"
        title="Notification token refresh failed"
        body="Push registration is retrying. You can still view all alerts from Notification Center."
        meta="Retry in 30 seconds"
      />
    </ScreenShell>
  );
}
