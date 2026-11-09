import { useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { startOfMonth } from "@repo/formatting";
import { useActiveChapterId, useEvents, useNowDate } from "@repo/hooks";
import { SignetTokens } from "@repo/theme/signet";
import {
  SectionHeader,
  SectionHeaderSkeleton,
} from "@/components/list-section";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import {
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonRegion,
  SkeletonText,
} from "@/components/state-block";
import { InlineNote } from "@/components/inline-note";
import { Segmented } from "@/components/segmented";
import { AskSheet } from "@/components/ask/ask-sheet";
import { useCanCreateEvents } from "@/components/events/new-event-sheet";
import {
  createEventRowStyles,
  EventRowCard,
  EventRowFlat,
} from "@/components/events/event-rows";
import { EventsCalendar } from "@/components/events/events-calendar";
import { AskPill } from "@/components/chat/ask-pill";
import { isAskAvailable } from "@/lib/ask/flag";
import {
  selectAllEventRows,
  selectEventList,
  type EventDayGroup,
} from "@/lib/events/select";
import {
  setEventsView,
  useEventsView,
  type EventsView,
} from "@/lib/events/events-view";
import { typeRole, useFrappTheme } from "@/lib/theme";

/**
 * s06 — Events (`canvas-screens.dc.html:195`), as a List or a Calendar.
 *
 * **List** (#3707): what a member can still act on — anything upcoming, plus
 * anything whose check-in window is still open — from today through the next
 * two weeks, under written-out day headings (Today, Tomorrow, Sunday,
 * November 14). A repeating series is one row, its next occurrence, with
 * "Every Sunday" after the name; its other dates are on the event's page.
 * Everything past the two weeks waits behind Later. Finished events fall off:
 * attendance history is a reports surface.
 *
 * **Calendar** (#3792): a month grid marking every occurrence, and the
 * selected day's events under it (`components/events/events-calendar.tsx`).
 *
 * The List | Calendar switch opens on whichever the member used last on this
 * phone (`lib/events/events-view.ts`; per device, #3823).
 *
 * The ✦ Ask pill in the header is the s06 half of the global Ask entry.
 * `spec/ui/mobile/navigation.md` § Global entries puts it "in the top bar of
 * Chat home and Events", and only in a build that has Ask (#2259). The sheet
 * it opens is hosted here rather than routed to, per
 * `spec/ui/mobile/patterns.md` § Bottom sheets.
 *
 * An officer who can create events (`events:create`) adds one from the tab
 * bar's quick-actions + (New event, `components/quick-actions/`); the
 * one-line zero state points at it, as Tasks' does.
 *
 * The board's Going / Can't buttons and "Going ✓" marker are not drawn: RSVP
 * has no server model yet (`spec/behavior/events.md`), and they come back with
 * the endpoint (#1035), as on s07.
 */

const VIEW_OPTIONS = [
  { value: "list", label: "List" },
  { value: "calendar", label: "Calendar" },
] as const satisfies readonly { value: EventsView; label: string }[];

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export default function EventsScreen() {
  const chapterId = useActiveChapterId();
  const router = useRouter();
  const eventsQuery = useEvents();
  const askSheetRef = useRef<BottomSheetModal>(null);
  const canCreateEvents = useCanCreateEvents();
  const view = useEventsView();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);

  // One `now` per render so every row agrees on what "today" and "open" mean,
  // and it ticks so a check-in window opens and closes on a tab that never
  // unmounts rather than staying as it was when the screen first rendered.
  const now = useNowDate();
  const allEvents = useMemo(
    () => selectAllEventRows(eventsQuery.data),
    [eventsQuery.data],
  );
  const list = useMemo(
    () => selectEventList(allEvents, now),
    [allEvents, now],
  );

  // Held here, not in the views, so List → Calendar → List keeps both places.
  // Until the member moves the calendar, it follows the clock: the tab never
  // unmounts, so a month and day fixed at mount would leave yesterday selected
  // after midnight. `null` means "wherever today is".
  const [showLater, setShowLater] = useState(false);
  const [pickedMonth, setPickedMonth] = useState<Date | null>(null);
  const [pickedDay, setPickedDay] = useState<Date | null>(null);
  const monthAnchor = pickedMonth ?? startOfMonth(now);
  const selectedDay = pickedDay ?? startOfDay(now);

  const refresh = useRefetchAll([eventsQuery]);

  function openEvent(eventId: string) {
    // Object form, because s07 now takes a param. Covered by the `pathname:`
    // matcher in `lib/routes.spec.ts`.
    router.push({ pathname: "/event-details", params: { id: eventId } });
  }

  function renderDayGroups(groups: EventDayGroup[], leadCard: boolean) {
    return groups.map((group, groupIndex) => {
      // The next event is the page's one card; the rest of its day, and every
      // later day, sit flush on the floor (owner pick 2026-11-05).
      const card = leadCard && groupIndex === 0 ? group.entries[0] : null;
      const flat = card ? group.entries.slice(1) : group.entries;
      return (
        <View key={group.day} style={styles.dayGroup}>
          <SectionHeader>{group.heading}</SectionHeader>
          {card ? (
            <EventRowCard
              event={card.event}
              cadence={card.cadence}
              now={now}
              onPress={() => openEvent(card.event.id)}
            />
          ) : null}
          {flat.length > 0 ? (
            <View>
              {flat.map(({ event, cadence }, index) => (
                <EventRowFlat
                  key={event.id}
                  event={event}
                  cadence={cadence}
                  now={now}
                  isFirst={index === 0}
                  onPress={() => openEvent(event.id)}
                />
              ))}
            </View>
          ) : null}
        </View>
      );
    });
  }

  // One line where the rows would be, not a card (`writing.md` § 4, rule 7):
  // the fact, and for a creator the way to change it, which is the tab bar's
  // + (New event) rather than a button of the screen's own.
  const nothingScheduled = canCreateEvents
    ? "Nothing scheduled yet. Tap + to add the first event."
    : "Nothing scheduled yet.";

  function renderList() {
    const { soon, later } = list;
    if (soon.length === 0 && later.length === 0) {
      return <InlineNote>{nothingScheduled}</InlineNote>;
    }

    const laterCount = later.reduce(
      (total, group) => total + group.entries.length,
      0,
    );

    return (
      <>
        {soon.length > 0 ? (
          renderDayGroups(soon, true)
        ) : (
          <InlineNote>Nothing in the next two weeks.</InlineNote>
        )}
        {laterCount > 0 ? (
          <View style={styles.dayGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                showLater
                  ? "Hide later events"
                  : `Show ${laterCount} later ${laterCount === 1 ? "event" : "events"}`
              }
              accessibilityState={{ expanded: showLater }}
              onPress={() => setShowLater((shown) => !shown)}
              style={styles.laterToggle}
            >
              <SectionHeader>Later</SectionHeader>
              <Text style={styles.laterAction}>
                {showLater ? "Hide" : `Show ${laterCount}`}
              </Text>
            </Pressable>
            {showLater ? renderDayGroups(later, false) : null}
          </View>
        ) : null}
      </>
    );
  }

  function renderBody() {
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

    if (view === "calendar") {
      return (
        <EventsCalendar
          events={allEvents}
          now={now}
          monthAnchor={monthAnchor}
          selectedDay={selectedDay}
          onMonthChange={setPickedMonth}
          onSelectDay={(day) => {
            // A picked day holds its month too, so the grid and the list
            // under it never part when the clock moves on.
            setPickedDay(day);
            setPickedMonth(startOfMonth(day));
          }}
          onOpen={openEvent}
          // With nothing scheduled, Calendar says what the List says (by the
          // List's own test), and points a creator at the +.
          emptyNote={
            list.soon.length === 0 && list.later.length === 0
              ? nothingScheduled
              : null
          }
        />
      );
    }
    return renderList();
  }

  return (
    <ScreenShell
      title="Events"
      refresh={refresh}
      headerAction={
        // No pill in a build without Ask (#2259) — see `app/(app)/(tabs)/index.tsx`.
        isAskAvailable() ? (
          <AskPill onPress={() => askSheetRef.current?.present()} />
        ) : undefined
      }
    >
      {chapterId ? (
        <Segmented
          options={VIEW_OPTIONS}
          value={view}
          onChange={setEventsView}
          accessibilityLabel="Events view"
        />
      ) : null}

      {renderBody()}

      <AskSheet ref={askSheetRef} />
    </ScreenShell>
  );
}

/** Event name widths, cycled, so the placeholder rows don't read as a grid. */
const SKELETON_NAME_WIDTHS = ["62%", "48%", "56%", "52%"] as const;

/** Flat rows drawn under the next-event card's placeholder. */
const SKELETON_FLAT_ROWS = 3;

/**
 * The list's loading state, on the loaded list's own styles: a day heading,
 * the next event as {@link EventRowCard} (the name and meta lines, a chip
 * where the points land), then a heading and flat rows as
 * {@link EventRowFlat} draws them, hairline-split. Which headings land
 * depends on the data, so they are bars.
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
  const rowStyles = createEventRowStyles(tokens);
  const { body, caption, title } = tokens.typography.role;

  return (
    <SkeletonRegion label="Loading chapter events" style={styles.skeletonList}>
      <View style={styles.dayGroup}>
        <SectionHeaderSkeleton width="18%" />
        <View style={rowStyles.card}>
          <View style={rowStyles.body}>
            <SkeletonText role={title} width={SKELETON_NAME_WIDTHS[0]} />
            <SkeletonText role={caption} width="40%" />
            <View style={rowStyles.footer}>
              <SkeletonBlock
                width={tokens.spacing["3xl"]}
                height={tokens.spacing.xl}
              />
            </View>
          </View>
        </View>
      </View>

      <View>
        <SectionHeaderSkeleton width="22%" />
        {Array.from({ length: rows }, (_, index) => (
          <View
            key={index}
            style={[
              rowStyles.flatRow,
              index === 0 ? null : rowStyles.flatDivider,
            ]}
          >
            <View style={rowStyles.body}>
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
    // A day's heading sits close over its rows; days are spaced by the shell.
    dayGroup: {
      gap: tokens.spacing.sm,
    },
    laterToggle: {
      flexDirection: "row",
      alignItems: "flex-end",
      justifyContent: "space-between",
      minHeight: tokens.touch.minimum,
    },
    laterAction: {
      ...typeRole({
        ...tokens.typography.role.caption,
        weight: tokens.typography.weight.semibold,
      }),
      color: tokens.color.text.mutedForeground,
    },
  });
}
