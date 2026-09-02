import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEvent } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { exportEventToCalendar } from "@/lib/calendar-export";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  CHECK_IN_GRACE_MINUTES,
  formatClock,
  formatEventWindow,
  resolveCheckInWindow,
} from "@/lib/events/format";
import { selectEventDetail } from "@/lib/events/select";
import { tint, typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s07 — Event detail (`canvas-screens.dc.html:246`).
 *
 * **This filename is a contract and must never be renamed**: `frapp://event-details`
 * is baked into `.ics` files already exported to members' calendars, so a
 * rename orphans every one of them (`spec/ui/mobile/screens.md:29`).
 *
 * Reached with an `id` param from s06 and from the Chat home UP NEXT strip.
 * Without one there is no event to render — the screen says so rather than
 * inventing a placeholder, which is what it used to do: until C2 this file was
 * a hardcoded "Frapp Chapter Meeting" with a fabricated date.
 *
 * ## RSVP is drawn but deliberately inert
 *
 * The reference draws a "Going ✓ / Can't make it" row and a "GOING · 31" count.
 * Neither has a server behind it: `spec/behavior/events.md` records that
 * "pre-event RSVP intent (going / maybe / not-going, ahead of the window) is
 * not yet modelled". So the row renders in its drawn position, disabled, with
 * one honest line — and the count is omitted entirely rather than filled with a
 * number no endpoint could produce. Tracked for a real endpoint; see the PR.
 */

export default function EventDetailsScreen() {
  const { tokens } = useFrappTheme();
  const { accent } = useChapterBranding();
  const styles = createStyles(tokens, accent);
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string | string[] }>();
  const eventId = Array.isArray(params.id) ? params.id[0] : (params.id ?? "");

  const eventQuery = useEvent(eventId);
  const event = useMemo(
    () => selectEventDetail(eventQuery.data),
    [eventQuery.data],
  );

  const [calendarState, setCalendarState] = useState<
    "ready" | "exporting" | "exported" | "failed"
  >("ready");

  /*
    A ticking clock, not one frozen at mount.
    `apps/web/components/chat/renderers/event-card.tsx` carries the same tick for
    the same reason: this screen is often opened *before* check-in opens — a
    member arriving early taps through from UP NEXT — and a `new Date()` captured
    once would leave "Check-in hasn't opened / Opens at 6:00" on screen through
    6:00, 6:15 and past the close, with no way to reach the scanner but to back
    out and re-enter.

    30s granularity matches the web card and is well inside the 15-minute grace
    window; the interval stops once the window has fully closed so a detail
    screen left open overnight is not re-rendering forever. The server enforces
    the real window regardless — this is UX only.
  */
  const [now, setNow] = useState(() => new Date());
  const endTime = event?.end_time;
  useEffect(() => {
    if (!endTime) return;
    const closesAt =
      new Date(endTime).getTime() + CHECK_IN_GRACE_MINUTES * 60_000;
    if (!Number.isFinite(closesAt) || Date.now() > closesAt) return;

    const id = setInterval(() => {
      setNow(new Date());
      if (Date.now() > closesAt) clearInterval(id);
    }, 30_000);
    return () => clearInterval(id);
  }, [endTime]);

  const window = event
    ? resolveCheckInWindow(event.start_time, event.end_time, now)
    : null;

  async function handleCalendarExport() {
    if (!event) return;
    setCalendarState("exporting");

    try {
      const exportStarted = await exportEventToCalendar({
        title: event.name,
        description: event.description ?? "",
        location: event.location ?? "",
        startAtIso: event.start_time,
        endAtIso: event.end_time,
        // The deep link the filename contract exists for. Carries the id so a
        // calendar entry opens *this* event, not a bare screen.
        deepLinkUrl: `frapp://event-details?id=${event.id}`,
        // Only a series parent describes the series. A materialized child
        // carries its parent's id and exports as the single meeting it is.
        recurrenceRule: event.parent_event_id ? null : event.recurrence_rule,
      });

      setCalendarState(exportStarted ? "exported" : "failed");
    } catch {
      setCalendarState("failed");
    }
  }

  if (!eventId) {
    return (
      <ScreenShell title="Event" subtitle="No event selected.">
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Nothing to show</Text>
          <Text style={styles.stateBody}>
            Open an event from the Events tab to see its details.
          </Text>
        </View>
      </ScreenShell>
    );
  }

  if (eventQuery.isPending) {
    return (
      <ScreenShell title="Event" subtitle="Loading…">
        <View style={styles.stateBlock}>
          <ActivityIndicator color={tokens.color.text.muted} />
          <Text style={styles.stateBody}>Loading event…</Text>
        </View>
      </ScreenShell>
    );
  }

  if (eventQuery.isError || !event) {
    return (
      <ScreenShell title="Event" subtitle="This event couldn't be loaded.">
        <View style={styles.stateBlock}>
          <Text style={styles.stateTitle}>Couldn&apos;t load this event</Text>
          <Text style={styles.stateBody}>
            It may have been cancelled, or the server is unreachable.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try loading this event again"
            disabled={eventQuery.isFetching}
            onPress={() => void eventQuery.refetch()}
            style={({ pressed }) => [
              styles.retryButton,
              pressed ? styles.pressed : null,
            ]}
          >
            <Text style={styles.retryText}>
              {eventQuery.isFetching ? "Retrying…" : "Try again"}
            </Text>
          </Pressable>
        </View>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell
      title={event.name}
      subtitle={formatEventWindow(event.start_time, event.end_time, now)}
    >
      <View style={styles.badgeRow}>
        {event.is_mandatory ? (
          <View style={styles.mandatoryBadge}>
            <Text style={styles.mandatoryText}>Mandatory</Text>
          </View>
        ) : null}
        {event.point_value ? (
          <View style={styles.pointsBadge}>
            <Text style={styles.pointsText}>+{event.point_value} pts</Text>
          </View>
        ) : null}
        {event.location ? (
          <Text style={styles.location}>{event.location}</Text>
        ) : null}
      </View>

      {/* Check-in card — the drawn "Check-in is open · closes 6:15". */}
      <View style={styles.checkInCard}>
        {window?.state === "open" ? (
          <>
            <View style={styles.checkInHeader}>
              <Text style={styles.checkInTitle}>Check-in is open</Text>
              <Text style={styles.checkInMeta}>
                closes {formatClock(window.closesAt)}
              </Text>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Scan the check-in code"
              onPress={() =>
                router.push({
                  pathname: "/check-in",
                  params: { eventId: event.id },
                })
              }
              style={({ pressed }) => [
                styles.primaryButton,
                pressed ? styles.pressed : null,
              ]}
            >
              <Text style={styles.primaryButtonText}>Scan QR to check in</Text>
            </Pressable>
          </>
        ) : window?.state === "upcoming" ? (
          <>
            <Text style={styles.checkInTitle}>Check-in hasn&apos;t opened</Text>
            <Text style={styles.checkInMeta}>
              Opens at {formatClock(window.opensAt)}.
            </Text>
          </>
        ) : (
          <>
            <Text style={styles.checkInTitle}>Check-in is closed</Text>
            <Text style={styles.checkInMeta}>
              {window?.state === "closed"
                ? "This event's check-in window has ended."
                : "This event's times are unavailable."}
            </Text>
          </>
        )}
      </View>

      {/*
        RSVP: drawn, disabled, and honest about why. See the file header — there
        is no RSVP model server-side, so a working-looking control here would be
        a lie about what tapping it does.
      */}
      <View style={styles.rsvpCard}>
        <View style={styles.rsvpRow}>
          <View
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel="Going. RSVP is not available yet."
            style={[styles.rsvpButton, styles.rsvpDisabled]}
          >
            <Text style={styles.rsvpText}>Going</Text>
          </View>
          <View
            accessible
            accessibilityRole="button"
            accessibilityState={{ disabled: true }}
            accessibilityLabel="Can't make it. RSVP is not available yet."
            style={[styles.rsvpButton, styles.rsvpDisabled]}
          >
            <Text style={styles.rsvpText}>Can&apos;t make it</Text>
          </View>
        </View>
        <Text style={styles.rsvpNote}>
          RSVP isn&apos;t available yet — check in at the event to be counted.
        </Text>
      </View>

      {event.hasCheckInZone ? (
        <View style={styles.zoneNote}>
          <Text style={styles.zoneText}>
            {event.check_in_zone_name
              ? `Check-in requires you to be inside the ${event.check_in_zone_name} zone.`
              : "Check-in requires you to be at the event location."}
          </Text>
        </View>
      ) : null}

      {event.description ? (
        <DetailSection
          label="DETAILS"
          body={event.description}
          styles={styles}
        />
      ) : null}

      {event.notes ? (
        <DetailSection
          label="INTERNAL NOTES"
          body={event.notes}
          styles={styles}
        />
      ) : null}

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Add this event to your calendar"
        disabled={calendarState === "exporting"}
        onPress={() => void handleCalendarExport()}
        style={({ pressed }) => [
          styles.secondaryButton,
          pressed ? styles.pressed : null,
        ]}
      >
        <Text style={styles.secondaryButtonText}>
          {calendarState === "exporting"
            ? "Adding…"
            : calendarState === "exported"
              ? "Added to calendar"
              : calendarState === "failed"
                ? "Couldn't add — try again"
                : "Add to calendar"}
        </Text>
      </Pressable>
    </ScreenShell>
  );
}

/** DETAILS and INTERNAL NOTES share this shape; only the label and body differ. */
function DetailSection({
  label,
  body,
  styles,
}: {
  label: string;
  body: string;
  styles: ReturnType<typeof createStyles>;
}) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionLabel}>{label}</Text>
      <Text style={styles.sectionBody}>{body}</Text>
    </View>
  );
}

function createStyles(tokens: SignetTokens, accent: string) {
  return StyleSheet.create({
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: tokens.spacing.xs,
    },
    mandatoryBadge: {
      borderRadius: tokens.radius.chip,
      backgroundColor: tint(tokens.color.semantic.warning),
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    mandatoryText: {
      color: tokens.color.semantic.warning,
      ...typeRole(tokens.typography.role.caption),
    },
    pointsBadge: {
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.sm,
      paddingVertical: tokens.spacing.xs,
    },
    pointsText: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    location: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    checkInCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    checkInHeader: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
      gap: tokens.spacing.sm,
    },
    checkInTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    checkInMeta: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    primaryButton: {
      borderRadius: tokens.radius.chip,
      backgroundColor: accent,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      alignItems: "center",
    },
    primaryButtonText: {
      color: tokens.color.surface.background,
      ...typeRole(tokens.typography.role.label),
    },
    rsvpCard: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
    },
    rsvpRow: {
      flexDirection: "row",
      gap: tokens.spacing.sm,
    },
    rsvpButton: {
      flex: 1,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      paddingVertical: tokens.spacing.sm,
      alignItems: "center",
    },
    rsvpDisabled: {
      opacity: 0.45,
    },
    rsvpText: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.label),
    },
    rsvpNote: {
      color: tokens.color.text.muted,
      ...typeRole(tokens.typography.role.caption),
    },
    zoneNote: {
      borderRadius: tokens.radius.card,
      backgroundColor: tint(tokens.color.semantic.info),
      padding: tokens.spacing.md,
    },
    zoneText: {
      color: tokens.color.semantic.info,
      ...typeRole(tokens.typography.role.caption),
    },
    section: {
      gap: tokens.spacing.xs,
    },
    sectionLabel: {
      ...typeRole(tokens.typography.role.caption),
      letterSpacing: 0.8,
      textTransform: "uppercase",
      color: tokens.color.text.muted,
    },
    sectionBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    secondaryButton: {
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
      alignItems: "center",
    },
    secondaryButtonText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    pressed: {
      opacity: 0.7,
    },
    stateBlock: {
      borderRadius: tokens.radius.card,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
      padding: tokens.spacing.lg,
      gap: tokens.spacing.sm,
      alignItems: "flex-start",
    },
    stateTitle: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    stateBody: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.body),
    },
    retryButton: {
      marginTop: tokens.spacing.xs,
      borderRadius: tokens.radius.chip,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      paddingHorizontal: tokens.spacing.md,
      paddingVertical: tokens.spacing.sm,
    },
    retryText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
  });
}
