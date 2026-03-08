import { ScreenShell } from "@/components/screen-shell";
import { TaskLoopCard } from "@/components/task-loop-card";

export default function EventsScreen() {
  return (
    <ScreenShell
      title="Events"
      subtitle="Upcoming windows, check-in eligibility, and recovery states when connectivity degrades."
    >
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
