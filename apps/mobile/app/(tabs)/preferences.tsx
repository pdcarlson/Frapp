import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function PreferencesScreen() {
  return (
    <ScreenShell
      title="Preferences"
      subtitle="Control communication, quiet hours, and visual mode settings."
    >
      <InfoCard
        badge="Quiet hours"
        title="10:00 PM → 8:00 AM"
        body="Normal-priority notifications are delivered silently during this window."
      />
      <InfoCard
        title="Category controls"
        body="Enable or mute alerts for announcements, DMs, events, points, tasks, and service updates."
      />
      <InfoCard
        title="Theme mode"
        body="Use Light, Dark, or System to match your device and reading comfort."
      />
    </ScreenShell>
  );
}
