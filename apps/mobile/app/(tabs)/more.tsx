import { InfoCard, ScreenShell } from "@/components/screen-shell";
import { NavTile } from "@/components/nav-tile";

/**
 * s09 — More hub.
 *
 * Rows follow spec/ui/mobile/navigation.md §"More hub (s09)", in its order.
 * Profile leads because it leaves the tab bar in this slice and More becomes
 * its only entry point.
 *
 * Two deliberate departures from that table:
 *
 * - **The admin section** (host check-in, adjust points) is omitted. It is
 *   role-gated, and the gate belongs to C2/C4 — shipping the links now would
 *   expose admin affordances to every member, which is worse than shipping them
 *   late.
 * - **Chapter** is an extra row, and it is the only entry to the chapter picker
 *   (#764). The picker is deliberately not forced on members whose token lacks
 *   an `active_chapter_id` claim — see `lib/auth-gate.ts` for why that would be
 *   an outage rather than a feature while #805 is open — so it needs a door.
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
      <NavTile
        href="/(auth)/chapter-picker"
        title="Chapter"
        description="Switch between the chapters you belong to."
        accessibilityHint="Choose which chapter to open."
      />
      <InfoCard
        title="Coming next"
        body="Study, dues, documents, and directory are routed but not built yet — each lands with its own slice."
        badge="Roadmap"
      />
    </ScreenShell>
  );
}
