import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useMemo, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useRouter } from "expo-router";
import type { BottomSheetModal } from "@gorhom/bottom-sheet";
import { localIsoDate, startOfMonth } from "@repo/formatting";
import { EVENTS_COPY } from "@repo/validation";
import {
  useActiveChapterId,
  useChapterRoster,
  useEvents,
  useMemberBirthdays,
  useNowDate,
  useTasks,
  useViewerUserId,
} from "@repo/hooks";
import { memberLabel } from "@repo/hooks/display-names";
import { startOfDay } from "@repo/hooks/calendar-time-grid";
import { SignetTokens } from "@repo/theme/signet";
import { BACK_TO_ACTIVITY } from "@/components/back-row";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import { ErrorState, NoChapterState } from "@/components/state-block";
import { useCanCreateEvents } from "@/components/events/new-event-sheet";
import { pickedDayStart } from "@/lib/events/create-event";
import { useNewEventAt } from "@/lib/events/use-new-event-at";
import { useEventMenu } from "@/lib/events/use-event-menu";
import { useCalendarTaskMenu } from "@/lib/tasks/use-task-menu";
import {
  EventsCalendar,
  EventsCalendarSkeleton,
} from "@/components/events/events-calendar";
import { SuggestedEventsEntry } from "@/components/events/suggested-events-entry";
import { CalendarSubscribeSheet } from "@/components/events/calendar-subscribe-sheet";
import { CalendarPlusGlyph, PlusGlyph } from "@/components/control-glyphs";
import { HeaderButton } from "@/components/header-button";
import { useCalendarItemsByDay } from "@/lib/events/calendar-items";
import { isCurrentOrUpcoming } from "@/lib/events/format";
import { selectAllEventRows } from "@/lib/events/select";
import { useChapterBranding } from "@/lib/chapter-branding";
import { useFrappTheme } from "@/lib/theme";

/**
 * s06, the Calendar (`canvas-screens.dc.html:195`): the chapter's month and
 * the picked day's list under it, and nothing else above it but the month
 * row. A pushed screen since #5310 (Paul's direction B, 2026-11-17), opened
 * from the Calendar row on Activity, where it was the third tab. The route
 * stays `events`, so links and notification targets keep working.
 *
 * It was a List and a Calendar behind a switch, the Calendar a Month, 3 days
 * or Day behind a second one, and four chips that switched kinds off (#3707,
 * #3792, #4144, #4818). Paul (2026-11-17): "I hate the calendar page ... the
 * list and the calendar and like all of those options ... bars up top is not
 * great." Activity's To do is the list now; the month is the one view, and
 * it shows every kind: events (a series on each of its days, Mandatory in
 * the accent), the member's tasks and the ones they assigned on their due
 * day, and birthdays all day. One day's hour grid survives as its own
 * screen, opened from the picked day's heading (`app/(app)/calendar-day.tsx`).
 *
 * A member who can create events (`events:create`, every member by default
 * since #3709) adds one from the header's own + (#5113), as Apple Calendar
 * and Fantastical put add at the top right; with a later day picked, the
 * event starts that day. Subscribe (#3322) sits beside it.
 *
 * A long press on an event or a task under the day opens its menu (#5492):
 * Edit, Duplicate and Delete for an event (`useEventMenu`), a task's actions
 * for a task (`useCalendarTaskMenu`), each to a viewer the API lets use them.
 *
 * The board's Going / Can't buttons and "Going ✓" marker are not drawn: RSVP
 * has no server model yet (`spec/behavior/events.md`), and they come back with
 * the endpoint (#1035), as on s07.
 */

export default function EventsScreen() {
  const chapterId = useActiveChapterId();
  const router = useRouter();
  const eventsQuery = useEvents();
  const canCreateEvents = useCanCreateEvents();
  const { tokens } = useFrappTheme();
  const brand = useChapterBranding();
  const styles = createStyles(tokens);
  // Subscribe (#3322): the sheet asks for the member's calendar link only
  // while it is up.
  const subscribeSheet = useRef<BottomSheetModal>(null);
  const [subscribeOpen, setSubscribeOpen] = useState(false);
  // One `now` per render so every row agrees on what "today" and "open" mean,
  // and it ticks so a check-in window opens and closes while the screen is up.
  const now = useNowDate();
  // New event from the header's + (#5113), filled in to start on the picked
  // day.
  const newEvent = useNewEventAt(now);
  // Long-press menus on the day's rows (#5492).
  const eventMenu = useEventMenu();
  const taskMenu = useCalendarTaskMenu();
  const allEvents = useMemo(
    () => selectAllEventRows(eventsQuery.data),
    [eventsQuery.data],
  );
  const nothingAhead = useMemo(
    () =>
      !allEvents.some((event) =>
        isCurrentOrUpcoming(event.start_time, event.end_time, now),
      ),
    [allEvents, now],
  );

  // Until the member moves the calendar, it follows the clock, so a screen
  // left open past midnight doesn't keep yesterday selected. `null` means
  // "wherever today is".
  const [pickedMonth, setPickedMonth] = useState<Date | null>(null);
  const [pickedDay, setPickedDay] = useState<Date | null>(null);
  const monthAnchor = pickedMonth ?? startOfMonth(now);
  const selectedDay = pickedDay ?? startOfDay(now);

  const tasksByDay = useCalendarItemsByDay(selectedDay);
  const rosterQuery = useChapterRoster();
  const viewerUserId = useViewerUserId();
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

  // The reads the tasks and birthdays come from, so a pull refreshes them
  // too: a pull shows a birthday someone just shared (#4959).
  const tasksQuery = useTasks();
  const birthdaysQuery = useMemberBirthdays();
  const refresh = useRefetchAll([eventsQuery, tasksQuery, birthdaysQuery]);

  function openEvent(eventId: string) {
    // Object form, because s07 takes a param. Covered by the `pathname:`
    // matcher in `lib/routes.spec.ts`.
    router.push({ pathname: "/event-details", params: { id: eventId } });
  }

  // One line where the rows would be, not a card (`writing.md` § 4, rule 7):
  // the fact, and for a creator the way to change it, the header's + (#5113).
  // The fact is web's line too (#4135); the how is the phone's own.
  const nothingScheduled = canCreateEvents
    ? `${EVENTS_COPY.empty} Tap + to add the first event.`
    : EVENTS_COPY.empty;

  function renderBody() {
    // `useEvents` is `enabled: !!chapterId`, so with no active chapter the
    // query never runs and `isPending` never clears. Without this gate the
    // screen showed its loading state forever.
    if (!chapterId) return <NoChapterState noun="events" />;

    if (eventsQuery.isPending) return <EventsCalendarSkeleton />;

    if (eventsQuery.isError && eventsQuery.data === undefined) {
      // An explicit retry as well as the pull (#3385): a button is the
      // recovery a member sees without knowing the gesture.
      return (
        <ErrorState
          title={EVENTS_COPY.loadError}
          body={describeLoadFailure(eventsQuery.error)}
          onRetry={() => void eventsQuery.refetch()}
          isRetrying={eventsQuery.isFetching}
        />
      );
    }

    return (
      <EventsCalendar
        events={allEvents}
        tasksByDay={tasksByDay}
        nameOf={nameOf}
        onOpenTask={(taskId) =>
          router.push({ pathname: "/task-details", params: { id: taskId } })
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
        eventMenuFor={eventMenu.menuFor}
        taskMenuFor={taskMenu.menuForCalendarTask}
        onOpenDay={(day) =>
          router.push({
            pathname: "/calendar-day",
            params: { day: localIsoDate(day) },
          })
        }
        // With nothing current or upcoming, the day list says so, and
        // points a creator at the +.
        emptyNote={nothingAhead ? nothingScheduled : null}
      />
    );
  }

  return (
    <ScreenShell
      back={BACK_TO_ACTIVITY}
      title="Calendar"
      refresh={refresh}
      headerAction={
        chapterId ? (
          <View style={styles.headerActions}>
            <HeaderButton
              label="Subscribe to events in your calendar"
              onPress={() => {
                setSubscribeOpen(true);
                subscribeSheet.current?.present();
              }}
            >
              <CalendarPlusGlyph color={tokens.color.text.foreground} />
            </HeaderButton>
            {/* Add, rightmost and in the accent, since it acts on this
                screen (#5113). */}
            {canCreateEvents ? (
              <HeaderButton
                label="New event"
                onPress={() => newEvent.open(pickedDayStart(selectedDay, now))}
              >
                <PlusGlyph color={brand.accent} />
              </HeaderButton>
            ) : null}
          </View>
        ) : null
      }
    >
      {renderBody()}

      {chapterId ? <SuggestedEventsEntry /> : null}
      <CalendarSubscribeSheet
        ref={subscribeSheet}
        open={subscribeOpen}
        onDismiss={() => setSubscribeOpen(false)}
      />
      {newEvent.sheet}
      {eventMenu.host}
      {taskMenu.host}
    </ScreenShell>
  );
}

function createStyles(tokens: SignetTokens) {
  return StyleSheet.create({
    headerActions: {
      flexDirection: "row",
      alignItems: "center",
      gap: tokens.spacing.sm,
    },
  });
}
