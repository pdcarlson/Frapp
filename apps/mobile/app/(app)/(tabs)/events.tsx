import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { startOfMonth } from "@repo/formatting";
import { EVENTS_COPY, eventsCount } from "@repo/validation";
import {
  useActiveChapterId,
  useCalendarBirthdays,
  useCalendarTasks,
  useChapterRoster,
  useEvents,
  useNowDate,
  useTasks,
  useViewerUserId,
} from "@repo/hooks";
import {
  ALL_CALENDAR_LAYERS,
  calendarTasksByDay,
  parseCalendarLayers,
  type CalendarLayer,
} from "@repo/hooks/calendar-tasks";
import { memberLabel } from "@repo/hooks/display-names";
import { SignetTokens } from "@repo/theme/signet";
import {
  DayHeading,
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
import {
  NewEventSheet,
  useCanCreateEvents,
} from "@/components/events/new-event-sheet";
import {
  calendarHourStart,
  emptyEventDraft,
  type NewEventDraft,
} from "@/lib/events/create-event";
import { LeadTileSkeleton } from "@/components/lead-tile";
import {
  createEventRowStyles,
  EventRowCard,
  EventRowFlat,
} from "@/components/events/event-rows";
import { EventsCalendar } from "@/components/events/events-calendar";
import { SuggestedEventsEntry } from "@/components/events/suggested-events-entry";
import { CalendarLayerChips } from "@/components/events/calendar-tasks";
import { CalendarSubscribeSheet } from "@/components/events/calendar-subscribe-sheet";
import {
  CalendarPlusGlyph,
  DisclosureGlyph,
} from "@/components/control-glyphs";
import { HeaderButton } from "@/components/header-button";
import {
  selectAllEventRows,
  selectEventList,
  type EventDayGroup,
} from "@/lib/events/select";
import {
  setCalendarLayersRaw,
  setCalendarRange,
  setEventsView,
  useCalendarLayersRaw,
  useCalendarRange,
  useEventsView,
  type EventsView,
} from "@/lib/events/events-view";
import { useFrappTheme } from "@/lib/theme";

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
 * phone (`lib/events/events-view.ts`; per device, #3823), and so does the
 * Calendar's Month | 3 days | Day (#4818). In 3 days and Day, a member who
 * can create events taps an hour to open New event starting then.
 *
 * A member who can create events (`events:create`, every member by default
 * since #3709) adds one from the tab
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
  const canCreateEvents = useCanCreateEvents();
  const view = useEventsView();
  const calendarRange = useCalendarRange();
  const { tokens } = useFrappTheme();
  const styles = createStyles(tokens);
  // Subscribe (#3322): the sheet asks for the member's calendar link only
  // while it is up.
  const subscribeSheet = useRef<BottomSheetModal>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  // An hour pressed in the 3 days or Day grid (#4818): New event, filled in
  // to start then. One sheet per press (`key`), since a template seeds the
  // draft once.
  const createSheet = useRef<BottomSheetModal>(null);
  const [createAt, setCreateAt] = useState<{
    key: number;
    template: NewEventDraft;
  } | null>(null);
  useEffect(() => {
    if (createAt) createSheet.current?.present();
  }, [createAt]);

  // One `now` per render so every row agrees on what "today" and "open" mean,
  // and it ticks so a check-in window opens and closes on a tab that never
  // unmounts rather than staying as it was when the screen first rendered.
  const now = useNowDate();
  const allEvents = useMemo(
    () => selectAllEventRows(eventsQuery.data),
    [eventsQuery.data],
  );
  const list = useMemo(() => selectEventList(allEvents, now), [allEvents, now]);

  // Held here, not in the views, so List → Calendar → List keeps both places.
  // Until the member moves the calendar, it follows the clock: the tab never
  // unmounts, so a month and day fixed at mount would leave yesterday selected
  // after midnight. `null` means "wherever today is".
  const [showLater, setShowLater] = useState(false);
  const [pickedMonth, setPickedMonth] = useState<Date | null>(null);
  const [pickedDay, setPickedDay] = useState<Date | null>(null);
  const monthAnchor = pickedMonth ?? startOfMonth(now);
  const selectedDay = pickedDay ?? startOfDay(now);

  // Tasks on the Calendar (#4144): the member's own on their due day, and
  // the ones they assigned with where each stands, each kind a chip to
  // switch, remembered on this phone like the view.
  const calendarTasks = useCalendarTasks();
  const rosterQuery = useChapterRoster();
  const viewerUserId = useViewerUserId();
  const layersRaw = useCalendarLayersRaw();
  const shownLayers: ReadonlySet<CalendarLayer> = useMemo(
    () => parseCalendarLayers(layersRaw) ?? ALL_CALENDAR_LAYERS,
    [layersRaw],
  );
  // Members' shared birthdays (#4959), all-day on their day, with a chip.
  const calendarBirthdays = useCalendarBirthdays(selectedDay);
  const hasBirthdays = calendarBirthdays.length > 0;
  const offeredLayers = useMemo(() => {
    const offered = new Set<CalendarLayer>();
    if (!calendarTasks.hasMine && !calendarTasks.hasAssigned && !hasBirthdays) {
      return offered;
    }
    offered.add("events");
    if (calendarTasks.hasMine) offered.add("mine");
    if (calendarTasks.hasAssigned) offered.add("assigned");
    if (hasBirthdays) offered.add("birthdays");
    return offered;
  }, [calendarTasks.hasMine, calendarTasks.hasAssigned, hasBirthdays]);
  const tasksByDay = useMemo(
    () =>
      calendarTasksByDay(
        [...calendarTasks.items, ...calendarBirthdays],
        shownLayers,
      ),
    [calendarTasks.items, calendarBirthdays, shownLayers],
  );
  const nameOf = useMemo(() => {
    const names = new Map(
      (rosterQuery.data ?? []).map((member) => [
        member.user_id,
        member.display_name,
      ]),
    );
    return (userId: string) =>
      userId === viewerUserId ? "You" : memberLabel(names.get(userId), userId);
  }, [rosterQuery.data, viewerUserId]);
  function toggleLayer(layer: CalendarLayer) {
    const next = new Set(shownLayers);
    if (next.has(layer)) next.delete(layer);
    else next.add(layer);
    setCalendarLayersRaw(JSON.stringify([...next]));
  }

  // The same read `useCalendarTasks` draws from, so a pull refreshes both.
  const tasksQuery = useTasks();
  const refresh = useRefetchAll([eventsQuery, tasksQuery]);

  function openEvent(eventId: string) {
    // Object form, because s07 now takes a param. Covered by the `pathname:`
    // matcher in `lib/routes.spec.ts`.
    router.push({ pathname: "/event-details", params: { id: eventId } });
  }

  function renderDayGroups(groups: EventDayGroup[], leadCard: boolean) {
    return groups.map((group, groupIndex) => {
      // The next event is the page's one card; the rest of its day, and every
      // later day, sit flush on the floor (owner pick 2026-11-05), each
      // leading with a tile and ending in a chevron (his pick 2026-11-13,
      // #4679).
      const card = leadCard && groupIndex === 0 ? group.entries[0] : null;
      const flat = card ? group.entries.slice(1) : group.entries;
      return (
        <View key={group.day} style={styles.dayGroup}>
          <DayHeading>{group.heading}</DayHeading>
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
  // The fact is web's line too (#4135); the how is the phone's own, since
  // web has no tab bar +.
  const nothingScheduled = canCreateEvents
    ? `${EVENTS_COPY.empty} Tap + to add the first event.`
    : EVENTS_COPY.empty;

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
          <InlineNote>{EVENTS_COPY.noneSoon}</InlineNote>
        )}
        {laterCount > 0 ? (
          <View style={styles.dayGroup}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${EVENTS_COPY.later}, ${eventsCount(laterCount)}`}
              accessibilityState={{ expanded: showLater }}
              onPress={() => setShowLater((shown) => !shown)}
              style={styles.laterToggle}
            >
              {/* Web's words for the fold (#4135): the label and its count,
                  then a chevron drawn the way the phone's other folds draw
                  one (right folded, down open), rather than Show N / Hide. */}
              <SectionHeader count={eventsCount(laterCount)}>
                {EVENTS_COPY.later}
              </SectionHeader>
              <View style={styles.laterChevron}>
                <DisclosureGlyph
                  color={tokens.color.text.mutedForeground}
                  direction={showLater ? "down" : "right"}
                />
              </View>
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

    if (eventsQuery.isError && eventsQuery.data === undefined) {
      // An explicit retry as well as the pull (#3385): a button is the
      // recovery a member sees without knowing the gesture. C8 (#998) wired
      // `onlineManager`, so a connectivity blip recovers on its own; a server
      // error still needs one of the two.
      return (
        <ErrorState
          title={EVENTS_COPY.loadError}
          body={describeLoadFailure(eventsQuery.error)}
          onRetry={() => void eventsQuery.refetch()}
          isRetrying={eventsQuery.isFetching}
        />
      );
    }

    if (view === "calendar") {
      return (
        <EventsCalendar
          events={
            // Off only while its toggle is there to turn it back on: a
            // member whose tasks are all gone loses the chips, not events.
            shownLayers.has("events") || !offeredLayers.has("events")
              ? allEvents
              : []
          }
          tasksByDay={tasksByDay}
          nameOf={nameOf}
          onOpenTask={(taskId) =>
            router.push({ pathname: "/tasks", params: { task: taskId } })
          }
          layerChips={
            offeredLayers.size > 0 ? (
              <CalendarLayerChips
                offered={offeredLayers}
                shown={shownLayers}
                onToggle={toggleLayer}
              />
            ) : null
          }
          now={now}
          monthAnchor={monthAnchor}
          selectedDay={selectedDay}
          onMonthChange={(month) => {
            // The list under the grid follows the month on screen: today in
            // today's month, otherwise that month's 1st.
            setPickedMonth(month);
            const thisMonth =
              month.getFullYear() === now.getFullYear() &&
              month.getMonth() === now.getMonth();
            setPickedDay(thisMonth ? null : month);
          }}
          onSelectDay={(day) => {
            // A picked day holds its month too, so the grid and the list
            // under it never part when the clock moves on.
            setPickedDay(day);
            setPickedMonth(startOfMonth(day));
          }}
          onOpen={openEvent}
          range={calendarRange}
          onRangeChange={setCalendarRange}
          canCreate={canCreateEvents}
          onCreateAt={(day, hour) => {
            const start = calendarHourStart(day, hour, now);
            if (!start) return;
            setCreateAt((previous) => ({
              key: (previous?.key ?? 0) + 1,
              template: { ...emptyEventDraft(), start },
            }));
          }}
          // With nothing scheduled, Calendar says what the List says (by the
          // List's own test), and points a creator at the +, or in 3 days
          // and Day at an hour, as web's grid does.
          emptyNote={
            list.soon.length === 0 && list.later.length === 0
              ? calendarRange !== "month" && canCreateEvents
                ? `${EVENTS_COPY.empty} Tap an hour to add the first event.`
                : nothingScheduled
              : null
          }
        />
      );
    }
    return renderList();
  }

  return (
    <ScreenShell
      title="Calendar"
      refresh={refresh}
      headerAction={
        chapterId ? (
          <HeaderButton
            label="Subscribe to events in your calendar"
            onPress={() => {
              setSubscribeOpen(true);
              subscribeSheet.current?.present();
            }}
          >
            <CalendarPlusGlyph color={tokens.color.text.foreground} />
          </HeaderButton>
        ) : null
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

      {chapterId ? <SuggestedEventsEntry /> : null}
      <CalendarSubscribeSheet
        ref={subscribeSheet}
        open={subscribeOpen}
        onDismiss={() => setSubscribeOpen(false)}
      />
      {createAt ? (
        <NewEventSheet
          key={createAt.key}
          ref={createSheet}
          now={now}
          template={createAt.template}
          // The block landing in the grid where the hour was pressed is
          // the visible confirmation; a screen reader hears it said.
          onCreated={() =>
            AccessibilityInfo.announceForAccessibility("Event added.")
          }
        />
      ) : null}
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
 * {@link EventRowFlat} draws them: a tile, two lines, hairline-split. Which headings land
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
  const { caption, label, title } = tokens.typography.role;

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
              rowStyles.leadRow,
              index === 0 ? null : rowStyles.flatDivider,
            ]}
          >
            <LeadTileSkeleton />
            <View style={rowStyles.body}>
              <SkeletonText
                role={label}
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
    // The caption keeps its top margin, so the row sits on its baseline at
    // the bottom, the way an uncounted Later header sat.
    laterToggle: {
      flexDirection: "row",
      alignItems: "flex-end",
      minHeight: tokens.touch.minimum,
    },
    laterChevron: {
      marginLeft: "auto",
    },
  });
}
