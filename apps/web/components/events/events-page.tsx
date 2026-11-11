"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { OpenLinkedEvent } from "./open-linked-event";
import { ChevronDown, ListFilter, Plus } from "lucide-react";
import {
  RolesGlyph,
  SearchGlyph,
} from "@/components/events/chapter-ops-glyphs";
import {
  useAutoAbsent,
  useEvents,
  useMyPermissions,
  useNow,
} from "@repo/hooks";
// A subpath, like `error-copy`: pure functions a test's `@repo/hooks` mock
// must not swallow.
import {
  collapseSeries,
  eventSeriesKey,
  isSeriesEvent,
  seriesCadenceLabel,
  seriesHeadOf,
  splitByHorizon,
  type EventListEntry,
} from "@repo/hooks/event-series";
import {
  attendanceFieldsOf,
  can,
  canAll,
  EVENT_CREATE_PERMISSIONS,
  eventDefaultAttendance,
  eventSetsRolesApart,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { SegmentedChoice } from "@/components/ui/segmented";
import { EYEBROW } from "@/components/ui/typography";
import { anyReadUncached } from "@/components/shared/async-states";
import { NestedError, NestedOffline } from "@/components/shared/nested-states";
import { InlineNote, InlineNoteAction } from "@/components/shared/inline-note";
import { Can } from "@/components/shared/can";
import { SectionLabel } from "@/components/shared/section-label";
import { PageActions } from "@/components/layout/page-actions";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardTableCheckboxClassName,
  dashboardToolbarSearchClassName,
  dashboardToolbarSearchGlyphClassName,
  denseListClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/lib/hooks/use-toast";
import { EventDetailSheet } from "@/components/events/event-detail-sheet";
import {
  EventEditorDialog,
  isoToLocalInput,
} from "@/components/events/event-editor-dialog";
import {
  EventsCalendar,
  startOfMonth,
} from "@/components/events/events-calendar";
import { pointsLabel } from "@/components/events/event-labels";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import {
  formatDayHeading,
  formatRelativeDayTime,
  formatTimeOfDay,
  localIsoDate,
  parseInstant,
} from "@repo/formatting";
import { checkInClosesAt } from "@/components/events/check-in-close";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import {
  readEventsView,
  writeEventsView,
  type EventsView,
} from "@/lib/events/events-view";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn, getErrorMessage } from "@/lib/utils";
import { EventsPageSkeleton } from "@/components/events/events-skeleton";

type EventRow = Record<string, unknown>;
type Entry = EventListEntry<EventRow>;

// A day click carries no time of day, so the create form opens with a
// reasonable default slot (6-7pm) rather than midnight-to-midnight.
const CALENDAR_DEFAULT_START_HOUR = 18;

type TimeFilter = "upcoming" | "past" | "all";
type AttendanceFilter = "all" | "mandatory" | "optional";
type CadenceFilter = "all" | "recurring" | "one-time";

const TIME_OPTIONS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
  { value: "all", label: "All" },
] as const satisfies readonly { value: TimeFilter; label: string }[];

const ATTENDANCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "mandatory", label: "Mandatory" },
  { value: "optional", label: "Optional" },
] as const satisfies readonly { value: AttendanceFilter; label: string }[];

const CADENCE_OPTIONS = [
  { value: "all", label: "All" },
  { value: "recurring", label: "Repeating" },
  { value: "one-time", label: "One-time" },
] as const satisfies readonly { value: CadenceFilter; label: string }[];

const VIEW_OPTIONS = [
  { value: "list", label: "List" },
  { value: "calendar", label: "Calendar" },
] as const satisfies readonly { value: EventsView; label: string }[];

/*
 * The list's section label follows the Time filter. The card title it replaces
 * read "Upcoming & Recent Events" whatever the filter said, so under Past it
 * named events the list was not showing.
 */
const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  upcoming: "Upcoming",
  past: "Past",
  all: "All events",
};

function eventIdOf(event: EventRow): string {
  return String(event.id ?? event.name ?? "unknown-event");
}

function startMsOf(event: EventRow): number | null {
  return parseInstant(event.start_time)?.getTime() ?? null;
}

function eventsLabel(count: number): string {
  return `${count} event${count === 1 ? "" : "s"}`;
}

/**
 * Consecutive entries on the same local day, under that day's written-out
 * heading (`formatDayHeading`: Today, Tomorrow, Sunday, November 14). The
 * entries arrive sorted, so a day is one run.
 */
function groupByDay(
  entries: readonly Entry[],
  now: Date,
): { key: string; heading: string; entries: Entry[] }[] {
  const groups: { key: string; heading: string; entries: Entry[] }[] = [];
  for (const entry of entries) {
    const start = parseInstant(entry.event.start_time);
    const key = start ? localIsoDate(start) : "no-date";
    const last = groups[groups.length - 1];
    if (last && last.key === key) {
      last.entries.push(entry);
      continue;
    }
    groups.push({
      key,
      heading: start
        ? (formatDayHeading(entry.event.start_time, now) ?? "Date not set")
        : "Date not set",
      entries: [entry],
    });
  }
  return groups;
}

export function EventsPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { userId, isLoading: userLoading } = useFrappUser();
  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  // `null` until both the events read and the viewer resolve. The page opens
  // where this person last left it on this browser (#3822); without a stored
  // choice, a chapter with no events opens on the calendar, where the first
  // one gets made, and every other chapter opens on the list. Set once, so
  // creating that first event doesn't jump the officer from the calendar to
  // the list under their cursor.
  const [view, setView] = useState<EventsView | null>(null);
  const [attendanceFilter, setAttendanceFilter] =
    useState<AttendanceFilter>("all");
  const [recurrenceFilter, setRecurrenceFilter] =
    useState<CadenceFilter>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Bulk actions live behind Select (#3822): the default list has no
  // checkboxes.
  const [selecting, setSelecting] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  // What starts past the two-week horizon waits behind "Later" (#3707).
  const [laterOpen, setLaterOpen] = useState(false);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  // `POST /v1/events` and `PATCH /v1/events/:id` are paid-ops, so the editor's
  // entry points mirror the gate (#841). Routing the dialog through
  // `useGatedDialog` covers all three of them at once — the New event button,
  // a calendar day, and the detail sheet's Edit — and closes the dialog if the
  // subscription lapses while it is open.
  const eventWriteGate = useSubscriptionGate();
  const editorDialog = useGatedDialog(eventWriteGate);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [activeEvent, setActiveEvent] = useState<EventRow | null>(null);
  // The series a list row stands for, by key; its upcoming meetings are
  // derived from the live events below, so a realtime change reaches the
  // open sheet. `null` for a one-time event.
  const [activeSeriesKey, setActiveSeriesKey] = useState<string | null>(null);
  // Set only by a calendar day click, so the "New event" button keeps opening
  // a blank form.
  const [calendarCreateDay, setCalendarCreateDay] = useState<Date | null>(null);
  // Lifted here (not local to EventsCalendar) because the calendar unmounts
  // when the list is showing — see EventsCalendar's own comment.
  const [calendarMonthAnchor, setCalendarMonthAnchor] = useState<Date>(() =>
    startOfMonth(new Date()),
  );
  const eventsQuery = useEvents();
  const autoAbsent = useAutoAbsent();
  // The bulk action posts auto-absent, which is `events:update` and paid-ops
  // on the server, as in the attendance panel. A role without it gets no
  // Select button at all, and a lapsed chapter's button explains itself.
  const { data: permissionsPayload } = useMyPermissions();
  const canMarkAttendance = can(
    "events:update",
    permissionsPayload?.permissions,
  );
  // `POST /v1/events` needs `events:create` and the controller's class-level
  // `members:view`. Without both a calendar day is just a date, not a button
  // that opens a form the server will refuse.
  const canCreateEvents = canAll(
    EVENT_CREATE_PERMISSIONS,
    permissionsPayload?.permissions,
  );
  const { confirm, confirmDialog } = useConfirmDialog();

  // Live updates: any admin creating or editing an event in another tab
  // pushes through immediately. Scoped to the active chapter so we never
  // invalidate another chapter's cache.
  useRealtimeTable({
    table: "events",
    scopeId: activeChapterId,
    invalidate: [["events", activeChapterId]],
    enabled: Boolean(activeChapterId),
  });

  const events = useMemo(() => {
    if (Array.isArray(eventsQuery.data)) {
      return eventsQuery.data as EventRow[];
    }
    return [];
  }, [eventsQuery.data]);

  const nowTick = useNow();

  // The open series' meetings that haven't started, soonest first, read from
  // the live list (every series row, whatever the filters), and its head,
  // which holds the rule and the monthly anchor.
  const activeSeries = useMemo(() => {
    if (!activeSeriesKey) return null;
    return events
      .filter((event) => {
        if (eventSeriesKey(event) !== activeSeriesKey) return false;
        const start = startMsOf(event);
        return start !== null && start >= nowTick;
      })
      .sort((a, b) => (startMsOf(a) ?? 0) - (startMsOf(b) ?? 0));
  }, [activeSeriesKey, events, nowTick]);
  const activeSeriesHead = activeSeriesKey
    ? seriesHeadOf(activeSeriesKey, events)
    : null;

  // Offline, a viewer that isn't cached never loads (its query pauses), so
  // the page picks without it rather than hold the skeleton until reconnect.
  if (
    view === null &&
    eventsQuery.data !== undefined &&
    (!userLoading || isOffline)
  ) {
    setView(
      readEventsView(userId) ?? (events.length === 0 ? "calendar" : "list"),
    );
  }

  function chooseView(next: EventsView) {
    setView(next);
    writeEventsView(userId, next);
  }

  // Shared by both views: search text, attendance policy, cadence. Time
  // (upcoming/past/all) is deliberately NOT here — it's a list-view concept
  // ("what's coming up"), and applying it to the calendar would silently
  // empty out every day outside today's window the moment an officer
  // navigates to a past or far-future month.
  const matchesNonTimeFilters = useCallback(
    (event: EventRow) => {
      const queryLower = query.trim().toLowerCase();
      const name = String(event.name ?? "").toLowerCase();
      const location = String(event.location ?? "").toLowerCase();
      // A meeting of a series, head or generated. Only the head carries the
      // rule, so reading `recurrence_rule` alone filed every generated
      // occurrence as one-time.
      const isRecurring = isSeriesEvent(event);
      // Required of everyone by default, as the row's Mandatory badge and the
      // calendar say; an event that sets roles apart also carries "By role".
      const isMandatory =
        eventDefaultAttendance(attendanceFieldsOf(event)) === "required";

      if (
        queryLower &&
        !name.includes(queryLower) &&
        !location.includes(queryLower)
      ) {
        return false;
      }
      if (attendanceFilter === "mandatory" && !isMandatory) {
        return false;
      }
      if (attendanceFilter === "optional" && isMandatory) {
        return false;
      }
      if (recurrenceFilter === "recurring" && !isRecurring) {
        return false;
      }
      if (recurrenceFilter === "one-time" && isRecurring) {
        return false;
      }
      return true;
    },
    [query, attendanceFilter, recurrenceFilter],
  );

  const calendarEvents = useMemo(
    () => events.filter(matchesNonTimeFilters),
    [events, matchesNonTimeFilters],
  );

  // Soonest first, except Past, which reads back from the latest. A start
  // that can't be read sorts last.
  const filteredEvents = useMemo(() => {
    const now = nowTick;
    const inWindow = calendarEvents.filter((event) => {
      if (timeFilter === "all") return true;
      const start = startMsOf(event);
      // An event whose start cannot be read is shown under "upcoming" and
      // hidden under "past": it may still be ahead, and hiding it everywhere
      // would lose the row rather than mis-sort it.
      if (start === null) return timeFilter === "upcoming";
      if (timeFilter === "upcoming" && start < now) return false;
      if (timeFilter === "past" && start >= now) return false;
      return true;
    });
    const direction = timeFilter === "past" ? -1 : 1;
    return inWindow.sort((a, b) => {
      const aStart = startMsOf(a);
      const bStart = startMsOf(b);
      if (aStart === null) return bStart === null ? 0 : 1;
      if (bStart === null) return -1;
      return (aStart - bStart) * direction;
    });
  }, [calendarEvents, timeFilter, nowTick]);

  // One row per repeating series, its next meeting (#3707); meetings that
  // already happened stay rows of their own. Under Upcoming, what starts past
  // the two-week horizon waits behind Later.
  const { soonEntries, laterEntries } = useMemo(() => {
    const entries = collapseSeries(filteredEvents, nowTick);
    if (timeFilter !== "upcoming") {
      return { soonEntries: entries, laterEntries: [] as Entry[] };
    }
    const { soon, later } = splitByHorizon(entries, nowTick);
    return { soonEntries: soon, laterEntries: later };
  }, [filteredEvents, nowTick, timeFilter]);

  const calendarCreateDefaults = useMemo(() => {
    if (!calendarCreateDay) return null;
    const start = new Date(calendarCreateDay);
    start.setHours(CALENDAR_DEFAULT_START_HOUR, 0, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      startAt: isoToLocalInput(start.toISOString()),
      endAt: isoToLocalInput(end.toISOString()),
    };
  }, [calendarCreateDay]);

  // What a select-all reaches: the rows on screen, Later's only when open.
  const visibleEventIds = [
    ...soonEntries,
    ...(laterOpen ? laterEntries : []),
  ].map((entry) => eventIdOf(entry.event));
  // Only what is on screen counts: a row a filter, a search or a closed
  // Later hides keeps its tick for when it comes back, but the count and the
  // bulk action never reach it, so nothing is marked that the officer can't
  // see.
  const visibleIdSet = new Set(visibleEventIds);
  const selectedIdSet = new Set(selectedEventIds);
  const selectedVisibleIds = selectedEventIds.filter((eventId) =>
    visibleIdSet.has(eventId),
  );
  const allVisibleSelected =
    visibleEventIds.length > 0 &&
    visibleEventIds.every((eventId) => selectedIdSet.has(eventId));

  function toggleAllVisibleEvents(checked: boolean) {
    if (checked) {
      setSelectedEventIds((previous) => [
        ...new Set([...previous, ...visibleEventIds]),
      ]);
      return;
    }
    setSelectedEventIds((previous) =>
      previous.filter((eventId) => !visibleEventIds.includes(eventId)),
    );
  }

  function toggleEventSelection(eventId: string, checked: boolean) {
    if (checked) {
      setSelectedEventIds((previous) => [...new Set([...previous, eventId])]);
      return;
    }
    setSelectedEventIds((previous) =>
      previous.filter((candidate) => candidate !== eventId),
    );
  }

  function stopSelecting() {
    setSelecting(false);
    setSelectedEventIds([]);
  }

  // Keyed the way the selection is (`visibleEventIds`), so a selected id
  // always finds its row.
  const eventsById = useMemo(
    () =>
      new Map(
        events.map((event) => [String(event.id ?? event.name ?? ""), event]),
      ),
    [events],
  );

  // `POST /events/:id/attendance/auto-absent` is real, guarded, per-event
  // support for this action — it records ABSENT for whoever the event
  // required and never checked in or was otherwise marked. It refuses (400)
  // before an event's check-in grace period ends, so an event whose check-in
  // hasn't closed is failed here without being sent, and the rest go ahead.
  async function markSelectedAttendanceComplete() {
    const ids = [...selectedVisibleIds];
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: `Mark attendance complete for ${ids.length} event${ids.length > 1 ? "s" : ""}?`,
      description:
        "Members who didn't check in and weren't otherwise marked will be recorded absent. This cannot be undone.",
      confirmLabel: "Mark attendance complete",
    });
    if (!confirmed) return;

    // The API refuses (400) an event whose check-in hasn't closed, so it is
    // not sent: it fails here, by name, without the request (FRAPP-WEB-7,
    // #3905).
    const now = new Date();
    const notClosed = ids.flatMap((eventId) => {
      const closesAt = checkInClosesAt(
        eventsById.get(eventId)?.end_time,
        now.getTime(),
      );
      return closesAt
        ? [
            {
              eventId,
              message: `Check-in hasn't closed yet; it closes ${formatRelativeDayTime(closesAt.toISOString(), now)}.`,
            },
          ]
        : [];
    });
    const toSend = ids.filter(
      (eventId) => !notClosed.some((pending) => pending.eventId === eventId),
    );
    const results = await Promise.allSettled(
      toSend.map((eventId) => autoAbsent.mutateAsync(eventId)),
    );
    // `results` is positionally aligned with `toSend`, which is the only way
    // to name which event failed — `Promise.allSettled` itself carries no id.
    const failures = [
      ...notClosed,
      ...results.flatMap((result, index) =>
        result.status === "rejected"
          ? [
              {
                eventId: toSend[index]!,
                message: getErrorMessage(
                  result.reason,
                  "Try again in a moment.",
                ),
              },
            ]
          : [],
      ),
    ];
    const succeeded = ids.length - failures.length;

    if (failures.length === 0) {
      const totalMarked = results.reduce(
        (sum, result) =>
          sum +
          (result.status === "fulfilled" ? (result.value?.marked ?? 0) : 0),
        0,
      );
      toast({
        title: "Attendance finalized",
        description: `${succeeded} event${succeeded > 1 ? "s" : ""} processed, ${totalMarked} member${totalMarked === 1 ? "" : "s"} marked absent.`,
      });
      // Only the posted ticks clear: one a filter hid stays for when it
      // comes back.
      setSelectedEventIds((previous) =>
        previous.filter((eventId) => !ids.includes(eventId)),
      );
    } else {
      const eventName = (eventId: string) =>
        String(eventsById.get(eventId)?.name ?? eventId);
      const detail = failures
        .map(({ eventId, message }) => `${eventName(eventId)}: ${message}`)
        .join("; ");
      toast({
        title: "Some events couldn't be finalized",
        description: `${succeeded} succeeded, ${failures.length} failed. ${detail}`,
        variant: "destructive",
      });
    }
  }

  /*
   * The states are the nested family with `sole`, not the whole-screen ones:
   * those paint `--card`, which on a flush route redraws the card the route
   * deleted (`spec/ui/web-dashboard/README.md` § Page grammar).
   */
  if (isOffline && anyReadUncached(eventsQuery)) {
    return (
      <div className="space-y-4">
        <NestedOffline
          sole
          title={stateMicrocopy.events.offlineTitle}
          description={stateMicrocopy.events.offlineDescription}
          onRetry={() => {
            void eventsQuery.refetch();
          }}
        />
      </div>
    );
  }

  if (eventsQuery.isLoading) {
    return <EventsPageSkeleton />;
  }

  if (eventsQuery.isError) {
    return (
      <div className="space-y-4">
        <NestedError
          sole
          title={stateMicrocopy.events.errorTitle}
          description={describeLoadFailure(eventsQuery.error)}
          onRetry={() => void eventsQuery.refetch()}
        />
      </div>
    );
  }

  // Events are in but the viewer isn't yet, so the stored view can't be read:
  // hold the skeleton rather than paint the list and jump to the calendar
  // when the viewer lands.
  if (view === null && eventsQuery.data !== undefined) {
    return <EventsPageSkeleton />;
  }

  const eventWriteControls = eventWriteGate.controlProps();
  const searchText = query.trim();
  const currentView = view ?? "list";
  // The attendance and cadence filters narrow by kind. Time alone narrows by
  // when, and its miss gets its own line, since the default (Upcoming) hides
  // every past event without the officer having touched a filter.
  const narrowedByKind =
    attendanceFilter !== "all" || recurrenceFilter !== "all";
  const hasEvents = events.length > 0;
  // Filters away from their defaults, for the Filter button's count. Time
  // counts only on the list, the one view it applies to.
  const activeFilterCount =
    (currentView === "list" && timeFilter !== "upcoming" ? 1 : 0) +
    (attendanceFilter !== "all" ? 1 : 0) +
    (recurrenceFilter !== "all" ? 1 : 0);
  const shownCount = soonEntries.length + (laterOpen ? laterEntries.length : 0);
  const nowDate = new Date(nowTick);

  // The popover's Clear: every filter back to its default.
  function clearFilters() {
    setTimeFilter("upcoming");
    setAttendanceFilter("all");
    setRecurrenceFilter("all");
  }

  // The "No events match these filters" line's Clear filters: only the kind
  // filters it blames. Time stays, so an officer working in Past stays there.
  function clearKindFilters() {
    setAttendanceFilter("all");
    setRecurrenceFilter("all");
  }

  function openCreate(day: Date | null) {
    setEditorMode("create");
    setActiveEvent(null);
    setActiveSeriesKey(null);
    setCalendarCreateDay(day);
    editorDialog.setOpen(true);
  }

  // Any meeting of a series opens with its series, from a list row, a past
  // row or the calendar: the sheet then has the head's rule (a generated
  // meeting carries none) and the series' upcoming meetings.
  function openDetails(event: EventRow) {
    setActiveEvent(event);
    setActiveSeriesKey(eventSeriesKey(event));
    setDetailSheetOpen(true);
  }

  function renderRow(entry: Entry): ReactNode {
    const { event, series } = entry;
    const eventId = eventIdOf(event);
    const eventName = String(event.name ?? "Untitled event");
    const fields = attendanceFieldsOf(event);
    // "Mandatory" means required of everyone; an event that sets roles apart
    // says so with its own badge instead.
    const isMandatory = eventDefaultAttendance(fields) === "required";
    const isTargeted = eventSetsRolesApart(fields);
    // A series row says how it repeats where a one-time row says only its
    // time: the day heading above already says which day.
    const seriesKey = series ? eventSeriesKey(event) : null;
    const head = seriesKey ? seriesHeadOf(seriesKey, events) : null;
    const cadence = head
      ? seriesCadenceLabel(
          head.recurrence_rule,
          event.start_time,
          events
            .filter((candidate) => eventSeriesKey(candidate) === seriesKey)
            .map((candidate) => candidate.start_time),
        )
      : null;
    const time = formatTimeOfDay(event.start_time) || null;
    // One derived value: the row fill and the checkbox must never disagree
    // about whether the row is selected.
    const isSelected = selecting && selectedIdSet.has(eventId);
    const location =
      typeof event.location === "string" && event.location.trim()
        ? event.location.trim()
        : null;
    // An absent fact drops out of the line rather than reading "TBD" or "0".
    const meta = [
      [cadence, time].filter(Boolean).join(" · "),
      location,
      pointsLabel(event.point_value),
    ]
      .filter(Boolean)
      .join(" · ");
    return (
      <li
        key={eventId}
        className={cn(
          "flex items-center gap-1",
          // Fill means state, never striping.
          isSelected && "bg-popover",
        )}
      >
        {/*
          The row is the control: it opens the event's details. Its accessible
          name is its own text, so it always says exactly what the row shows.
        */}
        <button
          type="button"
          onClick={() => openDetails(event)}
          className={cn(
            "flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left transition-colors @xl:flex-row @xl:items-center @xl:gap-3",
            !isSelected && "hover:bg-card-hover hover:text-foreground",
            FOCUS_RING_OFFSET,
          )}
        >
          <span className="flex min-w-0 max-w-full flex-col @xl:flex-1">
            <span className="truncate text-sm font-semibold">{eventName}</span>
            {meta ? (
              <span className="truncate text-caption text-muted-foreground">
                {meta}
              </span>
            ) : null}
          </span>
          {isMandatory || isTargeted ? (
            <span className="flex shrink-0 flex-wrap items-center gap-1.5">
              {isMandatory ? (
                // The hairline kind (`components.md` §5's quiet metadata):
                // a red pill on every row of a chapter whose meetings are all
                // required drowned the list (#3822).
                <Badge variant="outline">Mandatory</Badge>
              ) : null}
              {isTargeted ? (
                <Badge variant="outline" className="gap-1">
                  <RolesGlyph className="h-3.5 w-3.5" />
                  By role
                </Badge>
              ) : null}
            </span>
          ) : null}
        </button>
        {/*
          The selection column is reserved whenever this viewer can bulk-mark,
          in or out of Select, so entering the mode or checking a row moves
          nothing (#3822).
        */}
        {canMarkAttendance ? (
          <span className="flex w-11 shrink-0 items-center justify-center">
            {selecting ? (
              <label className={dashboardCheckboxHitAreaClassName}>
                <input
                  type="checkbox"
                  aria-label={`Select ${eventName}`}
                  className={dashboardTableCheckboxClassName}
                  checked={isSelected}
                  onChange={(change) =>
                    toggleEventSelection(eventId, change.target.checked)
                  }
                />
              </label>
            ) : null}
          </span>
        ) : null}
      </li>
    );
  }

  function renderDays(entries: readonly Entry[], idPrefix: string): ReactNode {
    return groupByDay(entries, nowDate).map((group) => {
      const headingId = `${idPrefix}-${group.key}`;
      return (
        <div key={group.key} role="group" aria-labelledby={headingId}>
          <h3
            id={headingId}
            className="px-2 pb-1 pt-3 text-caption font-semibold text-foreground"
          >
            {group.heading}
          </h3>
          {/*
            `role="list"` restored explicitly: `display:flex` on an `<li>`
            drops its list-item box, and WebKit then stops exposing the list.
          */}
          <ul role="list" className={denseListClassName}>
            {group.entries.map(renderRow)}
          </ul>
        </div>
      );
    });
  }

  return (
    // A container (#4022): beside chat (#3779) the page is narrow while the
    // window is wide, so its toolbar and rows break on the page's own width
    // (`@xl`, 576px), not the viewport's.
    <div className="@container space-y-4">
      {/*
        One toolbar row (board `1f` pin 2): the List/Calendar toggle leads, as
        the page's primary control, then search and the one Filter button
        beside it; New event holds the trailing edge, as every route's actions
        do. The route's title is in the top bar (`top-bar.tsx`).

        `PageActions` renders its children as direct flex items, so a phone can
        reorder them: there the first line keeps the view toggle and New event,
        and search and Filter drop to their own row under it
        (`order-last w-full`).
      */}
      <PageActions className="justify-between gap-x-3 gap-y-2">
        <SegmentedChoice
          label="View"
          options={VIEW_OPTIONS}
          value={currentView}
          onChange={chooseView}
        />
        <div className="order-last flex w-full min-w-0 items-center gap-2 @xl:order-none @xl:mr-auto @xl:w-auto">
          <div className="relative min-w-0 flex-1 @xl:w-56 @xl:flex-none">
            <SearchGlyph className={dashboardToolbarSearchGlyphClassName} />
            <Input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search events"
              aria-label="Search events by name or location"
              className={dashboardToolbarSearchClassName}
            />
          </div>
          <Popover open={filtersOpen} onOpenChange={setFiltersOpen}>
            <PopoverTrigger asChild>
              <Button
                size="toolbar"
                variant="secondary"
                className="shrink-0 gap-2"
                aria-label={
                  activeFilterCount > 0
                    ? `Filter events, ${activeFilterCount} on`
                    : "Filter events"
                }
              >
                <ListFilter className="h-4 w-4" aria-hidden="true" />
                Filter
                {activeFilterCount > 0 ? (
                  <Badge variant="default" aria-hidden="true">
                    {activeFilterCount}
                  </Badge>
                ) : null}
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" className="w-auto min-w-72 space-y-4">
              {currentView === "list" ? (
                <FilterRow label="Time">
                  <SegmentedChoice
                    label="Time"
                    options={TIME_OPTIONS}
                    value={timeFilter}
                    onChange={setTimeFilter}
                    fill
                  />
                </FilterRow>
              ) : null}
              <FilterRow label="Attendance">
                <SegmentedChoice
                  label="Attendance"
                  options={ATTENDANCE_OPTIONS}
                  value={attendanceFilter}
                  onChange={setAttendanceFilter}
                  fill
                />
              </FilterRow>
              <FilterRow label="Cadence">
                <SegmentedChoice
                  label="Cadence"
                  options={CADENCE_OPTIONS}
                  value={recurrenceFilter}
                  onChange={setRecurrenceFilter}
                  fill
                />
              </FilterRow>
              <div className="flex justify-end">
                <Button
                  size="toolbar"
                  variant="ghost"
                  disabled={activeFilterCount === 0}
                  onClick={clearFilters}
                >
                  Clear
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
        <Can allOf={EVENT_CREATE_PERMISSIONS}>
          <Button
            size="toolbar"
            className="gap-2"
            {...eventWriteControls}
            onClick={() => openCreate(null)}
          >
            <Plus className="h-4 w-4" />
            New event
          </Button>
        </Can>
      </PageActions>

      {/*
        Under the row it explains. Search and the filters stay live: a lapsed
        chapter keeps full visibility of its own calendar.
      */}
      <SubscriptionNotice
        gate={eventWriteGate}
        feature="creating and editing events"
      />

      {currentView === "list" ? (
        /*
          The section stays at zero: its label and count, then one line where
          the rows would be (`components.md` §10). A miss says which kind of
          miss it is and offers the way back out; "No events yet" over a
          chapter whose events are all past would say something false
          (`writing.md` §7).
        */
        <section aria-labelledby="events-list-label">
          {/*
            The list header. Select swaps its trailing controls in place, and
            the select-all sits in the rows' reserved selection column, so
            nothing above or beside the rows moves (#3822). Notify assignees
            and Archive selected were removed rather than wired (#336): events
            have no assignee concept and no archive state.
          */}
          <div className="flex min-h-9 items-center gap-1 pointer-coarse:min-h-11">
            <div className="min-w-0 flex-1 px-2">
              <SectionLabel
                id="events-list-label"
                count={
                  selecting
                    ? `${selectedVisibleIds.length} selected`
                    : eventsLabel(soonEntries.length)
                }
              >
                {TIME_FILTER_LABELS[timeFilter]}
              </SectionLabel>
            </div>
            {/*
              Once in Select, its controls stay until Done, even when no row
              is on screen (Later collapsed, a search emptied the list), so
              the mode always has a way out.
            */}
            {canMarkAttendance && (selecting || shownCount > 0) ? (
              selecting ? (
                <>
                  <Button
                    size="toolbar"
                    variant="secondary"
                    {...eventWriteGate.controlProps(
                      autoAbsent.isPending || selectedVisibleIds.length === 0,
                    )}
                    onClick={() => void markSelectedAttendanceComplete()}
                  >
                    Mark attendance complete
                  </Button>
                  <Button
                    size="toolbar"
                    variant="ghost"
                    onClick={stopSelecting}
                  >
                    Done
                  </Button>
                </>
              ) : (
                <Button
                  size="toolbar"
                  variant="ghost"
                  onClick={() => setSelecting(true)}
                >
                  Select
                </Button>
              )
            ) : null}
            {canMarkAttendance && (selecting || shownCount > 0) ? (
              <span className="flex w-11 shrink-0 items-center justify-center">
                {selecting && shownCount > 0 ? (
                  <label className={dashboardCheckboxHitAreaClassName}>
                    <input
                      type="checkbox"
                      aria-label="Select all visible events"
                      className={dashboardTableCheckboxClassName}
                      checked={allVisibleSelected}
                      onChange={(change) =>
                        toggleAllVisibleEvents(change.target.checked)
                      }
                    />
                  </label>
                ) : null}
              </span>
            ) : null}
          </div>
          {filteredEvents.length === 0 ? (
            searchText ? (
              <InlineNote className="px-2">
                {stateMicrocopy.events.noSearchMatches}{" "}
                <InlineNoteAction onClick={() => setQuery("")}>
                  Clear search
                </InlineNoteAction>
              </InlineNote>
            ) : hasEvents && narrowedByKind ? (
              <InlineNote className="px-2">
                {stateMicrocopy.events.noFilterMatches}{" "}
                <InlineNoteAction onClick={clearKindFilters}>
                  Clear filters
                </InlineNoteAction>
              </InlineNote>
            ) : hasEvents ? (
              <InlineNote className="px-2">
                {timeFilter === "past"
                  ? stateMicrocopy.events.noPast
                  : stateMicrocopy.events.noUpcoming}{" "}
                <InlineNoteAction onClick={() => setTimeFilter("all")}>
                  Show all events
                </InlineNoteAction>
              </InlineNote>
            ) : (
              <InlineNote className="px-2">
                {stateMicrocopy.events.empty}
              </InlineNote>
            )
          ) : (
            <>
              {soonEntries.length === 0 ? (
                <InlineNote className="px-2">
                  {stateMicrocopy.events.noneSoon}
                </InlineNote>
              ) : (
                renderDays(soonEntries, "events-day")
              )}
              {laterEntries.length > 0 ? (
                <div className="mt-4">
                  <button
                    type="button"
                    aria-expanded={laterOpen}
                    aria-controls="events-later"
                    onClick={() => setLaterOpen((open) => !open)}
                    className={cn(
                      "flex min-h-9 w-full items-center gap-2 rounded-md px-2 text-left pointer-coarse:min-h-11 hover:bg-card-hover",
                      FOCUS_RING_OFFSET,
                    )}
                  >
                    <span className={`${EYEBROW} text-muted-foreground`}>
                      Later
                    </span>
                    <span className="text-caption text-muted tabular-nums">
                      {eventsLabel(laterEntries.length)}
                    </span>
                    <ChevronDown
                      aria-hidden="true"
                      className={cn(
                        "ml-auto h-4 w-4 text-muted-foreground transition-transform",
                        laterOpen && "rotate-180",
                      )}
                    />
                  </button>
                  {laterOpen ? (
                    <div id="events-later">
                      {renderDays(laterEntries, "events-later-day")}
                    </div>
                  ) : null}
                </div>
              ) : null}
            </>
          )}
        </section>
      ) : (
        /*
          Flush, with no card, title or description: the calendar names its
          own month, and a day number and an event chip say what they do.
        */
        <EventsCalendar
          events={calendarEvents}
          monthAnchor={calendarMonthAnchor}
          onMonthAnchorChange={setCalendarMonthAnchor}
          canCreate={canCreateEvents}
          chapterHasEvents={hasEvents}
          createDisabled={eventWriteControls.disabled}
          createDescribedBy={eventWriteControls["aria-describedby"]}
          createTitle={eventWriteControls.title}
          onSelectEvent={(event) => openDetails(event)}
          onCreateOnDay={openCreate}
        />
      )}

      {/* `/events?event=<id>` opens that event's sheet (`eventDeepLink`). In its
          own boundary: it reads the URL, which must not hold back the page. */}
      <Suspense fallback={null}>
        <OpenLinkedEvent
          events={events}
          idOf={eventIdOf}
          onOpen={openDetails}
        />
      </Suspense>

      <EventDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        event={activeEvent}
        series={activeSeries}
        seriesRule={activeSeriesHead?.recurrence_rule}
        onSelectOccurrence={(occurrence) => setActiveEvent(occurrence)}
        usingPreviewData={false}
        onRequestEdit={(event) => {
          setActiveEvent(event);
          setDetailSheetOpen(false);
          setEditorMode("edit");
          editorDialog.setOpen(true);
        }}
        onEventDeleted={async () => {
          await eventsQuery.refetch();
        }}
      />

      <EventEditorDialog
        open={editorDialog.open}
        onOpenChange={editorDialog.setOpen}
        onCloseAutoFocus={editorDialog.contentProps.onCloseAutoFocus}
        mode={editorMode}
        event={activeEvent}
        usingPreviewData={false}
        initialStartAt={calendarCreateDefaults?.startAt}
        initialEndAt={calendarCreateDefaults?.endAt}
        onSaved={async () => {
          await eventsQuery.refetch();
        }}
      />
      {confirmDialog}
    </div>
  );
}

/** One filter in the popover: its name over its segmented answers. */
function FilterRow({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <p className="text-caption font-semibold text-muted-foreground">
        {label}
      </p>
      {children}
    </div>
  );
}
