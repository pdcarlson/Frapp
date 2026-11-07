import { checkInZoneLine } from "@repo/validation";
import { useMemo, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEvent, useNowDate } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import { ScreenShell } from "@/components/screen-shell";
import { BACK_TO_EVENTS } from "@/components/back-row";
import { PressableRow } from "@/components/list-section";
import { SheetPrimaryButton } from "@/components/sheet-scaffold";
import {
  EmptyState,
  ErrorState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { AccentChip, StatusChip } from "@/components/status-chip";
import { exportEventToCalendar } from "@/lib/calendar-export";
import { useChapterBranding } from "@/lib/chapter-branding";
import {
  formatEventClock,
  formatEventWindow,
  resolveCheckInWindow,
  type CheckInWindow,
} from "@/lib/events/format";
import { selectEventDetail, type EventDetail } from "@/lib/events/select";
import { typeRole, useFrappTheme } from "@/lib/theme";

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
 * ## No RSVP control until RSVP exists
 *
 * The reference draws a "Going ✓ / Can't make it" row and a "GOING · 31" count.
 * Neither has a server behind it: `spec/behavior/events.md` records that
 * "pre-event RSVP intent (going / maybe / not-going, ahead of the window) is
 * not yet modelled". Both are omitted. The row used to render disabled in its
 * drawn position; a control that can never be enabled is the "coming soon"
 * shape App Review Guideline 2.1 rejects (#2300), so it comes back only with
 * the endpoint (#1035). A line that used to stand in for it ("Check in at the
 * event to be counted.") is gone too: the check-in card above already says it.
 *
 * ## Where the chips sit
 *
 * The board draws Mandatory and `+N pts` above the title and the place in the
 * line under it ("Tonight · 6:00 – 7:00 PM · Great Hall"). The place is in that
 * line here too. The chips sit under it, because `ScreenShell` draws the title
 * first and is frozen; they used to share a row with the place, which wrapped
 * a long location beside them.
 */

export default function EventDetailsScreen() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
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
    A ticking clock, not one frozen at mount: this screen is often opened
    *before* check-in opens — a member arriving early taps through from UP
    NEXT — and a `new Date()` captured once would leave "Check-in hasn't opened
    / opens 6:00" on screen through 6:00, 6:15 and past the close, with no
    way to reach the scanner but to back out and re-enter.

    It is the shared `@repo/hooks` clock the Events list and web's event card
    read, so this screen and the row it was opened from agree on whether the
    window is open. Its 30s tick is well inside the 15-minute grace window. The
    server enforces the real window regardless — this is UX only.
  */
  const now = useNowDate();

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
      <ScreenShell back={BACK_TO_EVENTS} title="Event">
        <EmptyState
          glyph="◷"
          title="Nothing to show"
          body="Open an event from the Events tab."
        />
      </ScreenShell>
    );
  }

  if (eventQuery.isPending) {
    return (
      <ScreenShell back={BACK_TO_EVENTS} title="Event">
        <EventDetailSkeleton />
      </ScreenShell>
    );
  }

  if (eventQuery.isError || !event) {
    return (
      <ScreenShell back={BACK_TO_EVENTS} title="Event">
        <ErrorState
          title="Couldn't load this event"
          body="It may have been cancelled, or the server is unreachable."
          onRetry={() => void eventQuery.refetch()}
          isRetrying={eventQuery.isFetching}
        />
      </ScreenShell>
    );
  }

  const window = resolveCheckInWindow(event.start_time, event.end_time, now);

  return (
    <ScreenShell
      back={BACK_TO_EVENTS}
      title={event.name}
      subtitle={[
        formatEventWindow(event.start_time, event.end_time, now),
        event.location,
      ]
        .filter(Boolean)
        .join(" · ")}
    >
      {event.is_mandatory || event.point_value ? (
        <View style={styles.badgeRow}>
          {event.is_mandatory ? (
            <StatusChip
              label="Mandatory"
              hue={tokens.color.semantic.destructive}
            />
          ) : null}
          {event.point_value ? (
            <AccentChip label={`+${event.point_value} pts`} />
          ) : null}
        </View>
      ) : null}

      <CheckInCard event={event} window={window} />

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

      <PressableRow
        accessibilityRole="button"
        accessibilityLabel="Add this event to your calendar"
        accessibilityState={{ disabled: calendarState === "exporting" }}
        disabled={calendarState === "exporting"}
        onPress={() => void handleCalendarExport()}
        // The press feedback the s06 cards use: a ripple on Android, rounded
        // to the button's corners by `PressableRow`'s clip and dropped while
        // exporting, and a lift from the card fill to `surface.popover` on iOS.
        onCard
        style={styles.secondaryButton}
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
      </PressableRow>
    </ScreenShell>
  );
}

/**
 * The drawn "● Check-in is open · closes 6:15" card. Open, it takes the
 * chapter's accent-tinted fill and border with the green status dot and the
 * scan button, as drawn. Before and after the window it is one neutral line
 * with a muted dot, since there is nothing to do yet or any more.
 *
 * A check-in zone is said here, on the card it constrains, as one muted line
 * while checking in is still possible. It used to be its own box painted in
 * info blue, a semantic hue the board never draws on this screen, and inside
 * a chapter the blue read as an alert rather than a condition.
 */
function CheckInCard({
  event,
  window,
}: {
  event: EventDetail;
  window: CheckInWindow;
}) {
  const { tokens } = useFrappTheme();
  const { accent, accentSubtle, accentBorder } = useChapterBranding();
  const styles = createStyles(tokens);
  const router = useRouter();
  const isOpen = window.state === "open";

  const title = isOpen
    ? "Check-in is open"
    : window.state === "upcoming"
      ? "Check-in hasn't opened"
      : window.state === "closed"
        ? "Check-in is closed"
        : "Check-in is unavailable";
  const trailing = isOpen
    ? `closes ${formatEventClock(window.closesAt)}`
    : window.state === "upcoming"
      ? `opens ${formatEventClock(window.opensAt)}`
      : null;
  const zone =
    event.hasCheckInZone && (isOpen || window.state === "upcoming")
      ? checkInZoneLine(event.check_in_zone_name)
      : null;

  return (
    <View
      style={[
        styles.checkInCard,
        isOpen
          ? { backgroundColor: accentSubtle, borderColor: accentBorder }
          : null,
      ]}
    >
      <View style={styles.checkInHeader}>
        <View
          style={[
            styles.dot,
            {
              backgroundColor: isOpen
                ? tokens.color.semantic.success
                : tokens.color.text.muted,
            },
          ]}
        />
        <Text
          style={[
            styles.checkInTitle,
            isOpen ? { color: accent } : null,
          ]}
        >
          {title}
        </Text>
        {trailing ? <Text style={styles.checkInMeta}>{trailing}</Text> : null}
      </View>

      {zone ? <Text style={styles.zoneText}>{zone}</Text> : null}

      {isOpen ? (
        // The app's one primary button (`sheet-scaffold.tsx`): 48pt, the
        // control radius, the chapter accent under `gold.onHouse` ink, as the
        // dues Pay button and every sheet's CTA draw it.
        <SheetPrimaryButton
          label="Scan QR to check in"
          accent={accent}
          onAccent={tokens.color.gold.onHouse}
          onPress={() =>
            router.push({
              pathname: "/check-in",
              params: { eventId: event.id },
            })
          }
        />
      ) : null}
    </View>
  );
}

/**
 * The screen's loading state, on the loaded screen's own styles: the check-in
 * card's frame and header line, and the Add to calendar button, whose label is
 * fixed and so renders as itself (components.md §10). The badge row and the
 * DETAILS and INTERNAL NOTES sections are left out: each draws only when the
 * event carries one, and a placeholder for one would leave a gap, and move the
 * button, when it doesn't land.
 *
 * Exported so `components/screen-skeletons.spec.tsx` can pin its shape.
 */
export function EventDetailSkeleton() {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { caption, label } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading event" style={styles.skeletonStack}>
      <View style={styles.checkInCard}>
        <View style={styles.checkInHeader}>
          <SkeletonBlock
            width={tokens.spacing.sm}
            height={tokens.spacing.sm}
            radius={tokens.spacing.xs}
          />
          <View style={styles.checkInTitleSkeleton}>
            <SkeletonText role={label} width="55%" />
          </View>
          <SkeletonText
            role={caption}
            width={tokens.spacing["3xl"] + tokens.spacing.lg}
          />
        </View>
      </View>

      <View style={styles.secondaryButton}>
        <Text style={styles.secondaryButtonText}>Add to calendar</Text>
      </View>
    </SkeletonRegion>
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

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // `ScreenShell`'s gap, which spaces the loaded screen's blocks.
    skeletonStack: {
      gap: tokens.spacing.md,
    },
    badgeRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
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
      gap: tokens.spacing.sm,
    },
    dot: {
      // The board draws 9; the 8pt spacing step is the nearest token, and
      // half of it rounds the square into a dot.
      width: tokens.spacing.sm,
      height: tokens.spacing.sm,
      borderRadius: tokens.spacing.xs,
    },
    checkInTitle: {
      flex: 1,
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
    // The title's flex, so the trailing caption sits where it lands.
    checkInTitleSkeleton: {
      flex: 1,
    },
    checkInMeta: {
      color: tokens.color.text.mutedForeground,
      ...typeRole(tokens.typography.role.caption),
    },
    zoneText: {
      color: tokens.color.text.mutedForeground,
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
      // The primary button's geometry (`SheetPrimaryButton`: the 48pt Primary
      // step, control radius), outlined as the board draws its secondary
      // buttons.
      height: tokens.touch.buttonLarge,
      borderRadius: tokens.radius.control,
      borderWidth: 1,
      borderColor: tokens.color.border.input,
      backgroundColor: tokens.color.surface.card,
      alignItems: "center",
      justifyContent: "center",
    },
    secondaryButtonText: {
      color: tokens.color.text.foreground,
      ...typeRole(tokens.typography.role.label),
    },
  });
}
