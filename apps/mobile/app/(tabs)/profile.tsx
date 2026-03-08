import { InfoCard, ScreenShell } from "@/components/screen-shell";

export default function ProfileScreen() {
  return (
    <ScreenShell
      title="Profile"
      subtitle="Manage your chapter identity, preferences, and notification behavior."
    >
      <InfoCard
        title="Account"
        body="Display name, photo, and bio are visible in directory and chat."
      />
      <InfoCard
        title="Notifications"
        body="Set quiet hours and category-level push preferences for announcements, events, points, and tasks."
      />
      <InfoCard
        title="Theme"
        body="Choose light, dark, or system mode with consistent contrast-safe color roles."
      />
    </ScreenShell>
  );
}
