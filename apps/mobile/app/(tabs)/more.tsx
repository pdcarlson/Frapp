import { InfoCard, ScreenShell } from "@/components/screen-shell";
import { NavTile } from "@/components/nav-tile";

export default function MoreScreen() {
  return (
    <ScreenShell
      title="More"
      subtitle="Secondary chapter tools, notifications, and account controls."
    >
      <NavTile
        href="/notifications"
        title="Notification Center"
        description="Review unread activity and category-level updates."
        accessibilityHint="Open notification history and deep-link alerts."
      />
      <NavTile
        href="/preferences"
        title="Preferences"
        description="Quiet hours, theme mode, and communication defaults."
        accessibilityHint="Manage quiet hours and category notification controls."
      />
      <NavTile
        href="/task-center"
        title="Task Center"
        description="Track assigned tasks, due dates, and confirmation state."
        accessibilityHint="Open assigned task queue and completion states."
      />
      <NavTile
        href="/service-hours"
        title="Service Hours"
        description="Log philanthropy work and monitor approval queue outcomes."
        accessibilityHint="Review submitted service entries and approvals."
      />
      <NavTile
        href="/documents-reports"
        title="Documents & Reports"
        description="Review chapter docs and export-ready reporting snapshots."
        accessibilityHint="Open documents and export report readiness statuses."
      />
      <InfoCard
        title="Coming next"
        body="Polished filters, sharing controls, and role-aware access will continue expanding in these workflows."
        badge="Roadmap"
      />
    </ScreenShell>
  );
}
