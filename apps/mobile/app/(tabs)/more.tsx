import { InfoCard, ScreenShell } from "@/components/screen-shell";
import { NavTile } from "@/components/nav-tile";

/**
 * s09 — More hub.
 *
 * Rows follow spec/ui/mobile/navigation.md §"More hub (s09)", in its order.
 * Profile leads because it leaves the tab bar in this slice and More becomes
 * its only entry point.
 *
 * Two deliberate departures from that table, both to be closed by cluster C4:
 *
 * - **Service hours** is not in the spec's row list, but `service-hours.tsx` is
 *   a live route that hosts the s20 sheet, and #937 puts it in C4's scope. It
 *   keeps a row here so the route does not become unreachable; the spec table
 *   is the thing that is incomplete.
 * - **The admin section** (host check-in, adjust points) is omitted. It is
 *   role-gated, and the gate belongs to C2/C4 — shipping the links now would
 *   expose admin affordances to every member, which is worse than shipping them
 *   late.
 *
 * Destinations that are still stubs are marked as such in their own files; this
 * slice restructures navigation only.
 */
export default function MoreScreen() {
  return (
    <ScreenShell
      title="More"
      subtitle="Secondary chapter tools, notifications, and account controls."
    >
      <NavTile
        href="/profile"
        title="Profile"
        description="Your membership, role, and points."
        accessibilityHint="Open your member profile."
      />
      <NavTile
        href="/study"
        title="Study hours"
        description="Track study sessions and weekly progress."
        accessibilityHint="Open study hours and session tracking."
      />
      <NavTile
        href="/dues"
        title="Dues"
        description="Balance, payment, and history."
        accessibilityHint="Open chapter dues and payment history."
      />
      <NavTile
        href="/documents"
        title="Documents"
        description="Chapter document library."
        accessibilityHint="Open the chapter document library."
      />
      <NavTile
        href="/directory"
        title="Directory"
        description="Actives and alumni."
        accessibilityHint="Open the member directory."
      />
      <NavTile
        href="/notifications"
        title="Notifications"
        description="Review unread activity and category-level updates."
        accessibilityHint="Open notification history and deep-link alerts."
      />
      <NavTile
        href="/service-hours"
        title="Service hours"
        description="Log philanthropy work and monitor approval queue outcomes."
        accessibilityHint="Review submitted service entries and approvals."
      />
      <NavTile
        href="/preferences"
        title="Settings"
        description="Quiet hours and communication defaults."
        accessibilityHint="Manage quiet hours and category notification controls."
      />
      <InfoCard
        title="Coming next"
        body="Study, dues, documents, and directory are routed but not built yet — each lands with its own slice."
        badge="Roadmap"
      />
    </ScreenShell>
  );
}
