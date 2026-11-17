import { describeLoadFailure } from "@repo/hooks/error-copy";
import { useMemo } from "react";
import { useLocalSearchParams, useRouter } from "expo-router";
import { startOfDay } from "@repo/hooks/calendar-time-grid";
import { EVENTS_COPY } from "@repo/validation";
import {
  useActiveChapterId,
  useEvents,
  useMemberBirthdays,
  useNowDate,
  useTasks,
} from "@repo/hooks";
import { BACK_TO_EVENTS } from "@/components/back-row";
import { useRefetchAll } from "@/components/pull-to-refresh";
import { ScreenShell } from "@/components/screen-shell";
import {
  ErrorState,
  NoChapterState,
  SkeletonBlock,
  SkeletonRegion,
} from "@/components/state-block";
import { useCanCreateEvents } from "@/components/events/new-event-sheet";
import { EventsTimeGrid } from "@/components/events/events-time-grid";
import { useCalendarItemsByDay } from "@/lib/events/calendar-items";
import { calendarHourStart } from "@/lib/events/create-event";
import { useNewEventAt } from "@/lib/events/use-new-event-at";
import { parseCalendarDayParam } from "@/lib/events/calendar-day";
import { selectAllEventRows } from "@/lib/events/select";

/**
 * One day's hour grid (#5310): pushed from the picked day's heading under
 * the Calendar's month, as Apple Calendar's month opens a day. It was the
 * Calendar's Day range behind a Month | 3 days | Day switch (#4818) until
 * the switch went; the 3 days range went with it.
 *
 * `day` is the local calendar day, `YYYY-MM-DD`. A missing or malformed one
 * draws today rather than nothing.
 *
 * A member who can create events taps an hour that isn't over to open New
 * event starting then (`calendarHourStart`), as before.
 */
export default function CalendarDayScreen() {
  const params = useLocalSearchParams<{ day?: string | string[] }>();
  const router = useRouter();
  const chapterId = useActiveChapterId();
  const eventsQuery = useEvents();
  const canCreateEvents = useCanCreateEvents();
  const now = useNowDate();
  const raw = Array.isArray(params.day) ? params.day[0] : params.day;
  const today = startOfDay(now).getTime();
  // Keyed on the param and today's date, not `now`, which ticks.
  const day = useMemo(
    () => parseCalendarDayParam(raw) ?? new Date(today),
    [raw, today],
  );
  const allEvents = useMemo(
    () => selectAllEventRows(eventsQuery.data),
    [eventsQuery.data],
  );
  const tasksByDay = useCalendarItemsByDay(day);
  const tasksQuery = useTasks();
  const birthdaysQuery = useMemberBirthdays();
  const refresh = useRefetchAll([eventsQuery, tasksQuery, birthdaysQuery]);

  const newEvent = useNewEventAt(now);

  const title = day.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    ...(day.getFullYear() === now.getFullYear()
      ? {}
      : { year: "numeric" as const }),
  });

  function renderBody() {
    if (!chapterId) return <NoChapterState noun="events" />;
    if (eventsQuery.isPending) {
      return (
        <SkeletonRegion label="Loading the day">
          <SkeletonBlock width="100%" height={480} />
        </SkeletonRegion>
      );
    }
    if (eventsQuery.isError && eventsQuery.data === undefined) {
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
      <EventsTimeGrid
        day={day}
        events={allEvents}
        now={now}
        tasksByDay={tasksByDay}
        onOpen={(eventId) =>
          router.push({ pathname: "/event-details", params: { id: eventId } })
        }
        onOpenTask={(taskId) =>
          router.push({ pathname: "/tasks", params: { task: taskId } })
        }
        canCreate={canCreateEvents}
        onCreateAt={(hourDay, hour) => {
          const start = calendarHourStart(hourDay, hour, now);
          if (start) newEvent.open(start);
        }}
      />
    );
  }

  return (
    <ScreenShell back={BACK_TO_EVENTS} title={title} refresh={refresh}>
      {renderBody()}
      {newEvent.sheet}
    </ScreenShell>
  );
}
