import { useMemo } from "react";
import { useRouter } from "expo-router";
import { StyleSheet, Text } from "react-native";
import { useEvents, useMyPermissions, useNotifications } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { can, canAny } from "@repo/validation";
import { ScreenShell } from "@/components/screen-shell";
import { CountBadge, NavTile } from "@/components/nav-tile";
import { selectEventRows } from "@/lib/events/select";
import { selectUnreadIds } from "@/lib/more/notifications";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s09 — More hub.
 *
 * Rows follow spec/ui/mobile/navigation.md §"More hub (s09)", in its order.
 * Profile leads because it leaves the tab bar in this slice and More becomes
 * its only entry point.
 *
 * **Chapter** is an extra row, and it is the only entry to the chapter picker
 * (#764). The picker is deliberately not forced on members whose token lacks an
 * `active_chapter_id` claim — see `lib/auth-gate.ts` for why that would be an
 * outage rather than a feature while #805 is open — so it needs a door.
 *
 * ## The admin section, and why it may look empty in production
 *
 * The gate is `useMyPermissions()` + `can`, the pattern `host-check-in.tsx`
 * established. That hook is `enabled: !!chapterId`, and no production token
 * carries an `active_chapter_id` claim while #805 is open — so in that
 * configuration the permission set is empty and this section renders for
 * nobody, Presidents included. It fails closed, which is the right direction,
 * but it does mean the section only appears once #805 lands (or on a local
 * stack, where `supabase/config.toml` enables the hook).
 *
 * ## What is still not the drawn s09
 *
 * Canvas draws a profile card, leading duotone glyphs, a grouped-list
 * container, and trailing status on Study hours and Dues. This screen keeps the
 * `NavTile` structure it shipped with and adds only the admin section, the real
 * unread badge, and honest copy. TODO-DESIGN: the full drawn anatomy
 * (`canvas-screens.dc.html:326`) is filed separately — the trailing statuses it
 * calls for read from study and dues data that C5/C6 own.
 */
export default function MoreScreen() {
  const router = useRouter();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  const { data: permData } = useMyPermissions();
  const permissions = useMemo(() => {
    const raw = (permData as { permissions?: unknown } | undefined)?.permissions;
    return Array.isArray(raw) ? (raw as string[]) : [];
  }, [permData]);
  // `can`/`canAny` from @repo/validation, never a bare `includes` — an owner's
  // grant is the wildcard `*`, so a membership test would hide these rows from
  // exactly the people who need them.
  const canHost = can("events:update", permissions);
  const canAdjustPoints = can("points:adjust", permissions);
  const showAdmin = canAny(["events:update", "points:adjust"], permissions);

  const notificationsQuery = useNotifications();
  const unreadCount = selectUnreadIds(notificationsQuery.data).length;

  // s22 takes an `eventId`, so the row resolves one rather than leading
  // nowhere. `selectEventRows` already returns upcoming-plus-still-checkable-in,
  // soonest first, so the head of that list is the event an officer would host.
  const eventsQuery = useEvents();
  const nextEvent = useMemo(() => {
    if (!canHost) return null;
    return selectEventRows(eventsQuery.data, new Date())[0] ?? null;
  }, [canHost, eventsQuery.data]);

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
        description="Recent activity, and what you haven't read."
        accessibilityHint="Open notification history and deep-link alerts."
        trailing={unreadCount > 0 ? <CountBadge count={unreadCount} /> : null}
      />
      <NavTile
        href="/service-hours"
        title="Service hours"
        description="Log philanthropy work and track approvals."
        accessibilityHint="Review submitted service entries and approvals."
      />
      <NavTile
        href="/preferences"
        title="Settings"
        description="Notifications, quiet hours, and your account."
        accessibilityHint="Manage quiet hours and category notification controls."
      />
      <NavTile
        href="/(auth)/chapter-picker"
        title="Chapter"
        description="Switch between the chapters you belong to."
        accessibilityHint="Choose which chapter to open."
      />

      {showAdmin ? (
        <>
          {/* TODO-DESIGN: Canvas labels this "ADMIN · PRESIDENT" — the viewer's
              role name. No role string is readable on mobile:
              `/v1/users/me/permissions` returns permissions only, and the
              roster projection carries names and avatars. Nearest pattern used:
              the section label without the role suffix. */}
          <Text style={styles.sectionHeader}>Admin</Text>
          {canHost ? (
            <NavTile
              title="Host check-in"
              description={
                nextEvent
                  ? "Project a rotating code for members to scan."
                  : "No upcoming event to host right now."
              }
              disabled={!nextEvent}
              trailing={
                nextEvent ? (
                  <Text numberOfLines={1} style={styles.trailingText}>
                    {nextEvent.name}
                  </Text>
                ) : null
              }
              accessibilityHint="Open the host check-in display for the next event."
              onPress={() => {
                if (!nextEvent) return;
                // Object form: the only navigation shape `lib/routes.spec.ts`
                // matches when a param is involved.
                router.push({
                  pathname: "/host-check-in",
                  params: { eventId: nextEvent.id },
                });
              }}
            />
          ) : null}
          {canAdjustPoints ? (
            <NavTile
              title="Adjust points"
              description="Awarding and fining members is on the web dashboard for now."
              disabled
            />
          ) : null}
        </>
      ) : null}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    sectionHeader: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.muted,
      textTransform: "uppercase",
      // Canvas gives s09's admin caption a wider letter-spacing and a 4px
      // indent than the section captions on s12/s14/s16; nothing documents
      // which is canonical, so each screen follows its own drawing.
      letterSpacing: 0.7,
      marginTop: tokens.spacing.sm,
      paddingLeft: tokens.spacing.xs,
    },
    trailingText: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
      maxWidth: 140,
    },
  });
}
