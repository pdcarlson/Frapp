import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function EventsScreen() {
  return (
    <ScreenShell
      title="Events"
      subtitle="Check in during event windows, track attendance status, and never miss required events."
    >
      <InfoCard
        badge="Today"
        title="Chapter Meeting • 6:00 PM"
        body="Check-in opens 15 minutes before start and closes 15 minutes after end."
      />
      <InfoCard
        title="Philanthropy Event • Saturday"
        body="Optional attendance • 15 points available."
      />
      <InfoCard
        badge="Calendar"
        title="Sync events to your phone calendar"
        body="Use Add to Calendar to keep chapter events in your personal schedule."
      />
    </ScreenShell>
  );
}
