import { StyleSheet, Text, View } from "react-native";
import { formatPoints, formatPointsChip, parseInstant } from "@repo/formatting";
import { useRequiredOfViewer } from "@repo/hooks";
import { NAV_GLYPHS } from "@repo/theme/nav-glyphs";
import { SignetTokens } from "@repo/theme/signet";
import { ForwardGlyph } from "@/components/control-glyphs";
import { LEAD_TILE_GLYPH, LeadTile } from "@/components/lead-tile";
import { gutterBleed, PressableRow } from "@/components/list-section";
import { NavGlyph } from "@/components/nav-glyph";
import { AccentChip, HairlineChip } from "@/components/status-chip";
import { formatEventClock, resolveCheckInWindow } from "@/lib/events/format";
import type { EventRow } from "@/lib/events/select";
import { typeRole, useFrappTheme } from "@/lib/theme";
import { pageSurfaces } from "@/lib/surfaces";

/**
 * The s06 event rows, shared by the List and the Calendar's day list (#3823).
 *
 * The day is the heading above them ("Tomorrow", `formatDayHeading`), so a row
 * says only its time. The board's date block ("THU / 14") went with the day
 * headings: under a "Thursday" heading it said the day twice (#3707).
 *
 * A series row carries how often it meets after the name, muted:
 * "Chapter · Every Sunday".
 */

function clockOf(event: EventRow): string {
  return formatEventClock(parseInstant(event.start_time));
}

function accessibilityLabelOf(event: EventRow, cadence: string | null) {
  return cadence ? `Open ${event.name}, ${cadence}` : `Open ${event.name}`;
}

function useCheckInOpen(event: EventRow, now: Date): boolean {
  return (
    resolveCheckInWindow(
      event.start_time,
      event.end_time,
      now,
      event.check_in_opens_minutes,
    ).state === "open"
  );
}

/** The name, with a series' cadence after it in the muted caption colour. */
function EventName({
  event,
  cadence,
  style,
  numberOfLines,
}: {
  event: EventRow;
  cadence: string | null;
  style: object;
  numberOfLines?: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createEventRowStyles(tokens);
  return (
    <Text numberOfLines={numberOfLines} style={style}>
      {cadence ? (
        <>
          {event.name}
          <Text style={styles.cadence}>{` · ${cadence}`}</Text>
        </>
      ) : (
        event.name
      )}
    </Text>
  );
}

/**
 * The next event, as the page's one card: the name (with Mandatory beside
 * it), a muted "6:00 PM · Great Hall" line, then the points chip and the
 * check-in status. The name leads: it is the largest, heaviest text.
 */
export function EventRowCard({
  event,
  cadence,
  now,
  onPress,
}: {
  event: EventRow;
  cadence: string | null;
  now: Date;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createEventRowStyles(tokens);
  const required = useRequiredOfViewer()(event.attendance);
  const meta = [clockOf(event), event.location].filter(Boolean).join(" · ");
  const isOpen = useCheckInOpen(event, now);

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelOf(event, cadence)}
      accessibilityHint="View event details and check in."
      onPress={onPress}
      // The card is itself a card, so it lifts to the step above it on iOS;
      // `PressableRow` rounds its Android ripple to the card's corners.
      onCard
      style={styles.card}
    >
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <EventName event={event} cadence={cadence} style={styles.title} />
          {required ? <HairlineChip label="Mandatory" /> : null}
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}

        {event.point_value || isOpen ? (
          <View style={styles.footer}>
            {event.point_value ? (
              <AccentChip label={formatPointsChip(event.point_value)} />
            ) : null}
            {isOpen ? (
              <Text style={styles.openNow}>Check-in is open</Text>
            ) : null}
          </View>
        ) : null}
      </View>
    </PressableRow>
  );
}

/**
 * Any other event: on the floor with a hairline between rows, in the one row
 * anatomy (`spec/ui/mobile/patterns.md` § Rows): the Events glyph in a lead
 * tile, the name, a meta line, then the drawn chevron of a row that opens.
 * It is the row Activity's To do draws for the same event, so an event has
 * one shape on both tabs (owner pick 2026-11-13, #4679; until then the row
 * was two lines of text with nothing that said it opened).
 *
 * Points move into the meta line, as web writes them ("7:00 PM · Great Room
 * · 10 points", `formatPoints`: a count read as text is written out; a chip
 * says "+10 pts"), and Mandatory sits before the chevron, so a row is one
 * line of chips at most.
 */
export function EventRowFlat({
  event,
  cadence,
  now,
  isFirst,
  onPress,
}: {
  event: EventRow;
  cadence: string | null;
  now: Date;
  isFirst: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createEventRowStyles(tokens);
  const required = useRequiredOfViewer()(event.attendance);
  const meta = [
    clockOf(event),
    event.location,
    event.point_value ? formatPoints(event.point_value) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const isOpen = useCheckInOpen(event, now);

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabelOf(event, cadence)}
      accessibilityHint="View event details and check in."
      onPress={onPress}
      style={[styles.leadRow, isFirst ? null : styles.flatDivider]}
    >
      <EventLeadTile />
      <View style={styles.body}>
        <EventName
          event={event}
          cadence={cadence}
          numberOfLines={1}
          style={styles.leadTitle}
        />
        {meta ? (
          <Text numberOfLines={1} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
        {isOpen ? <Text style={styles.openNow}>Check-in is open</Text> : null}
      </View>
      {/* Hairline, as web's row draws it (#3822, #4132): required of this
          viewer, by default or by a role of theirs (`useRequiredOfViewer`). */}
      {required ? <HairlineChip label="Mandatory" /> : null}
      <ForwardGlyph color={tokens.color.text.mutedForeground} />
    </PressableRow>
  );
}

/**
 * What leads an event's row under a day heading: the Events glyph, neutral,
 * as Activity's row leads one (`ACTIVITY_GLYPH_NAV.event`). Not the date
 * block: the heading above the row already says the day.
 */
function EventLeadTile() {
  const { tokens } = useFrappTheme();
  return (
    <LeadTile size="lead" testID="event-lead-tile">
      <NavGlyph
        paths={NAV_GLYPHS.events}
        color={tokens.color.text.mutedForeground}
        size={LEAD_TILE_GLYPH}
      />
    </LeadTile>
  );
}

export function createEventRowStyles(tokens: SignetTokens) {
  const surfaces = pageSurfaces(tokens);
  return StyleSheet.create({
    card: {
      flexDirection: "row",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: surfaces.card,
      padding: tokens.spacing.lg,
    },
    flatRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.md,
      // Square and hairline-split like the Directory's member rows, so it
      // bleeds the same way: content on the gutter line, press feedback clear
      // of it.
      ...gutterBleed(tokens, { rounded: false }),
    },
    flatDivider: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: tokens.color.border.hairline,
    },
    // A row that leads with a 40pt tile (`patterns.md` § Rows): Activity's
    // row frame, so the tile sets the height and the padding is the small
    // step, where a row of text alone takes the medium one.
    leadRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.md,
      minHeight: tokens.touch.minimum,
      paddingVertical: tokens.spacing.sm,
      ...gutterBleed(tokens, { rounded: false }),
    },
    // The row's title: the label role, as every tile row's is.
    leadTitle: {
      ...typeRole(tokens.typography.role.label),
      color: tokens.color.text.foreground,
    },
    // After the name, in the title's size at the regular weight (a weight is
    // its own Figtree family).
    cadence: {
      fontFamily: typeRole(tokens.typography.role.body).fontFamily,
      color: tokens.color.text.mutedForeground,
    },
    body: {
      flex: 1,
      minWidth: 0,
      gap: tokens.spacing.xs,
    },
    titleRow: {
      flexDirection: "row",
      alignItems: "center",
      flexWrap: "wrap",
      gap: tokens.spacing.sm,
    },
    title: {
      flexShrink: 1,
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    meta: {
      ...typeRole(tokens.typography.role.caption),
      color: tokens.color.text.mutedForeground,
    },
    footer: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
      marginTop: tokens.spacing.xs,
    },
    openNow: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.semantic.success,
    },
  });
}
