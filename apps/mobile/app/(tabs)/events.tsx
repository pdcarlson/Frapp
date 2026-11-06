import { useMemo, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { useActiveChapterId, useEvents, useNowDate } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  gutterBleed,
  PressableRow,
  SectionHeader,
  SectionHeaderSkeleton,
} from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import {
  EmptyState,
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { AccentChip, StatusChip } from "@/components/status-chip";
import { AskSheet } from "@/components/ask/ask-sheet";
import { useCanCreateEvents } from "@/components/events/new-event-sheet";
import { AskPill } from "@/components/chat/ask-pill";
import { isAskAvailable } from "@/lib/ask/flag";
import {
  formatEventDateBlock,
  resolveCheckInWindow,
} from "@/lib/events/format";
import {
  groupByWeek,
  selectEventRows,
  type EventRow,
} from "@/lib/events/select";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s06 — Events list (`canvas-screens.dc.html:195`).
 *
 * Rows are the chapter's real events from `GET /v1/events`, filtered to what a
 * member can still act on: anything upcoming, plus anything whose check-in
 * window is still open. Finished events deliberately fall off — attendance
 * history is a reports surface, and a list that grows forever buries tonight's
 * meeting under last semester's.
 *
 * The ✦ Ask pill in the header is the s06 half of the global Ask entry.
 * `spec/ui/mobile/navigation.md` § Global entries puts it "in the top bar of
 * Chat home and Events", and only in a build that has Ask (#2259). The sheet
 * it opens is hosted here rather than routed to, per
 * `spec/ui/mobile/patterns.md` § Bottom sheets.
 *
 * An officer who can create events (`events:create`) adds one from the tab
 * bar's quick-actions + (New event, `components/quick-actions/`); the empty
 * state points at it, as Tasks' does.
 *
 * The board's Going / Can't buttons and "Going ✓" marker are not drawn: RSVP
 * has no server model yet (`spec/behavior/events.md`), and they come back with
 * the endpoint (#1035), as on s07.
 */

export default function EventsScreen() {
  const chapterId = useActiveChapterId();
  const router = useRouter();
  const eventsQuery = useEvents();
  const askSheetRef = useRef<BottomSheetModal>(null);
  const canCreateEvents = useCanCreateEvents();

  // One `now` per render so every row agrees on what "today" and "open" mean,
  // and it ticks so a check-in window opens and closes on a tab that never
  // unmounts rather than staying as it was when the screen first rendered.
  const now = useNowDate();
  const events = useMemo(
    () => selectEventRows(eventsQuery.data, now),
    [eventsQuery.data, now],
  );

  const refresh = useRefetchAll([eventsQuery]);

  function openEvent(eventId: string) {
    // Object form, because s07 now takes a param. Covered by the `pathname:`
    // matcher in `lib/routes.spec.ts`.
    router.push({ pathname: "/event-details", params: { id: eventId } });
  }

  function renderList() {
    // `useEvents` is `enabled: !!chapterId`, so with no active chapter the
    // query never runs and `isPending` never clears. Without this gate the tab
    // showed its loading state forever.
    if (!chapterId) return <NoChapterState noun="events" />;

    if (eventsQuery.isPending) return <EventListSkeleton />;

    if (eventsQuery.isError) {
      // An explicit retry as well as the pull (#3385): a button is the
      // recovery a member sees without knowing the gesture. C8 (#998) wired
      // `onlineManager`, so a connectivity blip recovers on its own; a server
      // error still needs one of the two.
      return (
        <ErrorState
          title="Couldn't load events"
          body="The server couldn't be reached."
          onRetry={() => void eventsQuery.refetch()}
          isRetrying={eventsQuery.isFetching}
        />
      );
    }

    if (events.length === 0) {
      return (
        <EmptyState
          glyph="◷"
          title="Nothing scheduled"
          // The title says it; only the way to change it is worth a line
          // (`writing.md` § 4, Empty states).
          body={canCreateEvents ? "Tap + to add an event." : undefined}
        />
      );
    }

    // The next event is the one card on the page; everything after it is a
    // flush row, as web's Events list draws its rows. Mobile adds the This
    // week / Later split the Tasks tab already uses (owner pick 2026-11-05,
    // recorded in `spec/ui/mobile/screens.md` s06).
    const [next, ...rest] = events;
    const { thisWeek, later } = groupByWeek(rest, now);

    return (
      <>
        <EventRowCard
          key={next.id}
          event={next}
          now={now}
          onPress={() => openEvent(next.id)}
        />
        {thisWeek.length > 0 ? (
          <EventGroup
            label="This week"
            events={thisWeek}
            now={now}
            onOpen={openEvent}
          />
        ) : null}
        {later.length > 0 ? (
          <EventGroup
            label="Later"
            events={later}
            now={now}
            onOpen={openEvent}
          />
        ) : null}
      </>
    );
  }

  return (
    <ScreenShell
      title="Events"
      refresh={refresh}
      headerAction={
        // No pill in a build without Ask (#2259) — see `app/(tabs)/index.tsx`.
        isAskAvailable() ? (
          <AskPill onPress={() => askSheetRef.current?.present()} />
        ) : undefined
      }
    >
      {renderList()}

      <AskSheet ref={askSheetRef} />
    </ScreenShell>
  );
}

/**
 * One event, as the board draws it: a date block on the left, and on the
 * right the name (with Mandatory beside it), a muted "6:00 PM · Great Hall"
 * line, then the points chip and the check-in status. The name leads: it is
 * the largest, heaviest text on the card, and the place sits under it at
 * caption size. The card used to stack an accent time caption, a 14pt name and
 * a 16pt location, so the location was the biggest text on every card.
 *
 * The date block's label is neutral: "Today" in the foreground text so the
 * day's event stands out, any other day muted. A date is a label, never the
 * chapter accent (foundations.md §6, "Where the accent goes", 2026-11-05).
 */
function EventRowCard({
  event,
  now,
  onPress,
}: {
  event: EventRow;
  now: Date;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const window = resolveCheckInWindow(event.start_time, event.end_time, now);
  const date = formatEventDateBlock(event.start_time, now);
  const meta = [date?.clock, event.location].filter(Boolean).join(" · ");
  const isOpen = window.state === "open";

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={`Open ${event.name}`}
      accessibilityHint="View event details and check in."
      onPress={onPress}
      // The card is itself a card, so it lifts to `surface.popover` on iOS;
      // `PressableRow` rounds its Android ripple to the card's corners.
      onCard
      style={styles.card}
    >
      {date ? (
        <View style={styles.dateBlock}>
          <Text
            style={[
              styles.dateLabel,
              date.isToday ? styles.dateLabelToday : null,
            ]}
          >
            {date.label}
          </Text>
          <Text style={styles.dateDay}>{date.day}</Text>
        </View>
      ) : null}

      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Text style={styles.title}>{event.name}</Text>
          {event.is_mandatory ? (
            <StatusChip
              label="Mandatory"
              hue={tokens.color.semantic.destructive}
            />
          ) : null}
        </View>
        {meta ? <Text style={styles.meta}>{meta}</Text> : null}

        {event.point_value || isOpen ? (
          <View style={styles.footer}>
            {event.point_value ? (
              <AccentChip label={`+${event.point_value} pts`} />
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

function EventGroup({
  label,
  events,
  now,
  onOpen,
}: {
  label: string;
  events: EventRow[];
  now: Date;
  onOpen: (id: string) => void;
}) {
  return (
    <View>
      <SectionHeader>{label}</SectionHeader>
      {events.map((event, index) => (
        <EventRowFlat
          key={event.id}
          event={event}
          now={now}
          isFirst={index === 0}
          onPress={() => onOpen(event.id)}
        />
      ))}
    </View>
  );
}

/**
 * An event after the first: the same date block and name as the card, on the
 * floor with a hairline between rows. Points move into the meta line, as web
 * writes them ("7:00 PM · Great Room · 10 pts"), and Mandatory sits at the
 * row's end, so a row is one line of chips at most.
 */
function EventRowFlat({
  event,
  now,
  isFirst,
  onPress,
}: {
  event: EventRow;
  now: Date;
  isFirst: boolean;
  onPress: () => void;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const date = formatEventDateBlock(event.start_time, now);
  const meta = [
    date?.clock,
    event.location,
    event.point_value ? `${event.point_value} pts` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const isOpen =
    resolveCheckInWindow(event.start_time, event.end_time, now).state ===
    "open";

  return (
    <PressableRow
      accessibilityRole="button"
      accessibilityLabel={`Open ${event.name}`}
      accessibilityHint="View event details and check in."
      onPress={onPress}
      style={[styles.flatRow, isFirst ? null : styles.flatDivider]}
    >
      {date ? (
        <View style={styles.dateBlock}>
          <Text style={styles.dateLabel}>{date.label}</Text>
          <Text style={styles.flatDay}>{date.day}</Text>
        </View>
      ) : null}
      <View style={styles.body}>
        <Text numberOfLines={1} style={styles.flatTitle}>
          {event.name}
        </Text>
        {meta ? (
          <Text numberOfLines={1} style={styles.meta}>
            {meta}
          </Text>
        ) : null}
        {isOpen ? <Text style={styles.openNow}>Check-in is open</Text> : null}
      </View>
      {event.is_mandatory ? (
        <StatusChip label="Mandatory" hue={tokens.color.semantic.destructive} />
      ) : null}
    </PressableRow>
  );
}

/** Event name widths, cycled, so the placeholder rows don't read as a grid. */
const SKELETON_NAME_WIDTHS = ["62%", "48%", "56%", "52%"] as const;

/** Flat rows drawn under the next-event card's placeholder. */
const SKELETON_FLAT_ROWS = 3;

/**
 * The list's loading state, on the loaded list's own styles: the next event
 * as {@link EventRowCard} (the 52pt date column, the name and meta lines, a
 * chip where the points land), then a group caption and flat rows as
 * {@link EventRowFlat} draws them, hairline-split. Which caption lands (This
 * week or Later) depends on the data, so it is a bar.
 *
 * Exported so `components/screen-skeletons.spec.tsx` can pin its shape.
 */
export function EventListSkeleton({
  rows = SKELETON_FLAT_ROWS,
}: {
  rows?: number;
}) {
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  const { body, caption, headline, title } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading chapter events" style={styles.skeletonList}>
      <View style={styles.card}>
        <View style={styles.dateBlock}>
          <SkeletonText role={caption} width="70%" />
          <SkeletonText role={headline} width="50%" />
        </View>
        <View style={styles.body}>
          <SkeletonText role={title} width={SKELETON_NAME_WIDTHS[0]} />
          <SkeletonText role={caption} width="40%" />
          <View style={styles.footer}>
            <SkeletonBlock
              width={tokens.spacing["3xl"]}
              height={tokens.spacing.xl}
            />
          </View>
        </View>
      </View>

      <View>
        <SectionHeaderSkeleton width="22%" />
        {Array.from({ length: rows }, (_, index) => (
          <View
            key={index}
            style={[styles.flatRow, index === 0 ? null : styles.flatDivider]}
          >
            <View style={styles.dateBlock}>
              <SkeletonText role={caption} width="70%" />
              <SkeletonText role={title} width="44%" />
            </View>
            <View style={styles.body}>
              <SkeletonText
                role={body}
                width={
                  SKELETON_NAME_WIDTHS[
                    (index + 1) % SKELETON_NAME_WIDTHS.length
                  ]!
                }
              />
              <SkeletonText role={caption} width="46%" />
            </View>
          </View>
        ))}
      </View>
    </SkeletonRegion>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    // `ScreenShell`'s gap, which spaces the real cards.
    skeletonList: {
      gap: tokens.spacing.md,
    },
    card: {
      flexDirection: "row",
      gap: tokens.spacing.md,
      borderRadius: tokens.radius.cardLarge,
      borderWidth: 1,
      borderColor: tokens.color.border.hairline,
      backgroundColor: tokens.color.surface.card,
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
    flatDay: {
      ...typeRole(tokens.typography.role.title),
      color: tokens.color.text.foreground,
    },
    flatTitle: {
      ...typeRole(tokens.typography.role.body),
      fontFamily: typeRole({
        ...tokens.typography.role.body,
        weight: tokens.typography.weight.semibold,
      }).fontFamily,
      color: tokens.color.text.foreground,
    },
    dateBlock: {
      // 52 as drawn. No spacing token sits near it, and the column has to
      // hold "TODAY" over a two-digit day without shifting the names beside it.
      width: 52,
      alignItems: "center",
    },
    dateLabel: {
      // The board draws 11px / 700. `caption` is the smallest role, so it
      // keeps the role's size and takes the drawn weight.
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.bold,
      }),
      color: tokens.color.text.mutedForeground,
      letterSpacing: 0.6,
      textTransform: "uppercase",
    },
    dateLabelToday: {
      color: tokens.color.text.foreground,
    },
    dateDay: {
      ...typeRole(tokens.typography.role.headline),
      color: tokens.color.text.foreground,
    },
    body: {
      flex: 1,
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
