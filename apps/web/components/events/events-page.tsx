"use client";

import { describeLoadFailure } from "@repo/hooks/error-copy";
import {
  Suspense,
  useCallback,
  useMemo,
  useState,
  type ReactNode,
  useEffect,
  useRef,
} from "react";
import { OpenLinkedEvent } from "./open-linked-event";
import { CalendarSubscribeMenu } from "./calendar-subscribe-menu";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  RolesGlyph,
  SearchGlyph,
} from "@/components/events/chapter-ops-glyphs";
import {
  useAutoAbsent,
  useCalendarBirthdays,
  useCalendarTasks,
  useChapterRoster,
  useEvents,
  useMyPermissions,
  useNow,
  useRequiredOfViewer,
} from "@repo/hooks";
import {
  ALL_CALENDAR_LAYERS,
  calendarTasksByDay,
  type CalendarItem,
  type CalendarKind,
} from "@repo/hooks/calendar-tasks";
import { addDays } from "@repo/hooks/calendar-time-grid";
import { consecutiveDays, startOfDay } from "@repo/hooks/calendar-time-grid";
import { calendarKindOf } from "@repo/hooks/calendar-tasks";
import { memberLabel } from "@repo/hooks/display-names";
import {
  AGENDA_ROW_CLASS,
  AgendaBirthdayRow,
  AgendaMarkSlot,
  AgendaTaskRow,
} from "@/components/events/calendar-tasks";
import {
  KindKey,
  MiniMonth,
  WeekStrip,
} from "@/components/events/events-navigator";
import {
  calendarEventFacts,
  EventsTimeGrid,
} from "@/components/events/events-time-grid";
import {
  EVENT_HUE,
  eventIdOf,
  eventKindStyle,
} from "@/components/events/event-kind";
// A subpath, like `error-copy`: pure functions a test's `@repo/hooks` mock
// must not swallow.
import {
  collapseSeries,
  eventSeriesKey,
  isSeriesEvent,
  seriesCadenceOf,
  seriesHeadOf,
  type EventListEntry,
} from "@repo/hooks/event-series";
import {
  attendanceFieldsOf,
  can,
  canAll,
  CHECK_IN_OPEN_LABEL,
  EVENT_CREATE_PERMISSIONS,
  eventSetsRolesApart,
  eventsCount,
} from "@repo/validation";
import { Button } from "@/components/ui/button";
import { NewButton } from "@/components/ui/new-button";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import { Input } from "@/components/ui/input";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import {
  ActiveFilterChips,
  FilterMenu,
  type FilterMenuFilter,
} from "@/components/shared/filter-menu";
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
  SuggestedEvents,
  useRecordPlannedEvent,
  type EventPlan,
} from "@/components/ai/suggested-events";
import { EventEditorDialog } from "@/components/events/event-editor-dialog";
import { isoToLocalInput } from "@/components/events/local-input";
import {
  hasKeptDraft,
  readKeptPanel,
  useKeptDraftKeys,
  writeKeptPanel,
} from "@repo/hooks/kept-drafts";
import { pointsLabel } from "@/components/events/event-labels";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import {
  formatDayHeading,
  formatRelativeDayTime,
  formatTimeRange,
  localIsoDate,
  parseInstant,
} from "@repo/formatting";
import {
  AGENDA_SPAN_DAYS,
  buildAgenda,
  dateOfKey,
  kindsByDay,
  type AgendaDay,
  type AgendaRow,
} from "@/lib/events/agenda";
import { useIsNarrow } from "@/lib/use-is-narrow";
import {
  checkInClosesAt,
  checkInOpenNow,
} from "@/components/events/check-in-close";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useFrappUser } from "@/lib/auth/use-frapp-user";
import {
  calendarCreateStart,
  readHiddenKinds,
  writeHiddenKinds,
} from "@/lib/events/events-view";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn, getErrorMessage } from "@/lib/utils";
import { EventsPageSkeleton } from "@/components/events/events-skeleton";

type EventRow = Record<string, unknown>;
type Entry = EventListEntry<EventRow>;

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

/*
 * The agenda's section label follows the Time filter. The card title it
 * replaced read "Upcoming & Recent Events" whatever the filter said, so under
 * Past it named events the list was not showing.
 */
const TIME_FILTER_LABELS: Record<TimeFilter, string> = {
  upcoming: "Upcoming",
  past: "Past",
  all: "All events",
};

function startMsOf(event: EventRow): number | null {
  return parseInstant(event.start_time)?.getTime() ?? null;
}

/**
 * At this pane width or wider the navigator is a small month beside the
 * agenda; narrower (beside chat, where the pane can be 375px) it is a week
 * strip over it. Measured on the page, not the viewport (#4022).
 */
const NAVIGATOR_BESIDE_AT = 720;

/** "Nothing today.", "Nothing on Monday.": a day the agenda shows empty. */
function nothingOn(heading: string): string {
  if (heading === "Today" || heading === "Tomorrow" || heading === "Yesterday")
    return `Nothing ${heading.toLowerCase()}.`;
  return `Nothing on ${heading}.`;
}

/** The editor a page was left with open (#4593). */
type KeptEditor = {
  mode: "create" | "edit";
  event: EventRow | null;
  plan: EventPlan | null;
  day: Date | null;
};

/** The editor's kept draft, by how it was opened. */
function editorDraftNameOf(editor: KeptEditor): string {
  if (editor.mode === "edit") {
    return `event-edit:${editor.event ? eventIdOf(editor.event) : ""}`;
  }
  if (editor.plan) return `event-create:plan:${editor.plan.suggestionId}`;
  if (editor.day) return `event-create:at:${editor.day.toISOString()}`;
  return "event-create";
}

export function EventsPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const { userId } = useFrappUser();
  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const [attendanceFilter, setAttendanceFilter] =
    useState<AttendanceFilter>("all");
  const [recurrenceFilter, setRecurrenceFilter] =
    useState<CadenceFilter>("all");
  // Beside chat the search is a glyph until pressed (#5560); it stays a
  // field while it holds text.
  const [searchOpen, setSearchOpen] = useState(false);
  // Bulk actions live behind Select (#3822): the default list has no
  // checkboxes.
  const [selecting, setSelecting] = useState(false);
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  // The chat card's Can't make it opens the sheet with the line open (#4660):
  // one ask for one event, counted so a repeat ask reaches a sheet already
  // showing it, and keyed so another occurrence never inherits it.
  const [excuseAsk, setExcuseAsk] = useState<{
    eventId: string;
    count: number;
  } | null>(null);
  // Set by the editor when a series save rebuilt the event it was opened on.
  const leftEditedEvent = useRef(false);
  // `POST /v1/events` and `PATCH /v1/events/:id` are paid-ops, so the editor's
  // entry points mirror the gate (#841). Routing the dialog through
  // `useGatedDialog` covers all three of them at once — the New event button,
  // a calendar day, and the detail sheet's Edit — and closes the dialog if the
  // subscription lapses while it is open.
  const eventWriteGate = useSubscriptionGate();
  const editorDialog = useGatedDialog(eventWriteGate);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  // The suggestion a create was opened from, while its form is open.
  const [eventPlan, setEventPlan] = useState<EventPlan | null>(null);
  const recordPlannedEvent = useRecordPlannedEvent();
  const [activeEvent, setActiveEvent] = useState<EventRow | null>(null);
  // The series a list row stands for, by key; its upcoming meetings are
  // derived from the live events below, so a realtime change reaches the
  // open sheet. `null` for a one-time event.
  const [activeSeriesKey, setActiveSeriesKey] = useState<string | null>(null);
  // Set only by a calendar day or hour click, so the "New event" button
  // keeps opening a blank form. Holds the start, hour included.
  const [calendarCreateDay, setCalendarCreateDay] = useState<Date | null>(null);
  // The editor's kept draft (#4593): one per way in, so a calendar slot or a
  // suggestion opens on its own prefill rather than on what New event left.
  const keptKeys = useKeptDraftKeys();
  const editorDraftName = editorDraftNameOf({
    mode: editorMode,
    event: activeEvent,
    plan: eventPlan,
    day: calendarCreateDay,
  });

  // Which form the page had open, kept when the page is left with it open
  // (#4593). Read once when the page mounts: if that form still holds a
  // draft, the officer comes back to it, beside chat, as they left it.
  function keepEditorOpen(next: KeptEditor | null) {
    writeKeptPanel(keptKeys.panel("events"), next);
  }
  // The editor the page was left with, waiting until the page could open it
  // itself (below, once the events and permissions are in).
  const [leftEditor, setLeftEditor] = useState<KeptEditor | null>(() => {
    const left = readKeptPanel<KeptEditor>(keptKeys.panel("events"));
    return left && hasKeptDraft(keptKeys.draft(editorDraftNameOf(left)))
      ? left
      : null;
  });
  // The day the agenda starts on, `null` for today, so a page left open past
  // midnight moves with it. A day picked on the navigator that the agenda
  // isn't showing re-anchors it there (#5560).
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  // The day last picked on the navigator: its ring.
  const [pickedKey, setPickedKey] = useState<string | null>(null);
  // How many days the agenda reaches; "Show more" adds four weeks.
  const [spanDays, setSpanDays] = useState(AGENDA_SPAN_DAYS);
  // The month the navigator shows and the week strip's first day, `null`
  // for today's.
  const [navMonth, setNavMonth] = useState<Date | null>(null);
  const [stripStartKey, setStripStartKey] = useState<string | null>(null);
  // A day heading's Hours opens the hour grid on that day; `null` is the
  // agenda.
  const [hoursDay, setHoursDay] = useState<Date | null>(null);
  // A column heading's Open narrows the grid to that one day.
  const [hoursSingle, setHoursSingle] = useState(false);
  // The day heading to bring into view, counted so picking the same day
  // again scrolls again.
  const [scrollTarget, setScrollTarget] = useState<{
    key: string;
    count: number;
  } | null>(null);
  const [layoutRef, narrowMeasured] =
    useIsNarrow<HTMLDivElement>(NAVIGATOR_BESIDE_AT);
  const narrow = narrowMeasured === true;
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

  const events = useMemo<EventRow[]>(
    () => eventsQuery.data ?? [],
    [eventsQuery.data],
  );

  // Reopen the editor the page was left with (#4593), once this viewer could
  // open it from the page: the create or edit permission and the
  // subscription gate, as its buttons have. An edit reopens on the event as
  // it is now, and not at all when the event has gone.
  useEffect(() => {
    if (!leftEditor) return;
    const permitted =
      leftEditor.mode === "edit" ? canMarkAttendance : canCreateEvents;
    if (!permitted || !eventWriteGate.allowed) return;
    let event: EventRow | null = null;
    if (leftEditor.mode === "edit") {
      if (!Array.isArray(eventsQuery.data)) return;
      const id = leftEditor.event ? eventIdOf(leftEditor.event) : "";
      event = events.find((row) => eventIdOf(row) === id) ?? null;
    }
    /* eslint-disable react-hooks/set-state-in-effect -- reopen, once, the form the page was left with */
    setLeftEditor(null);
    if (leftEditor.mode === "edit" && !event) {
      writeKeptPanel(keptKeys.panel("events"), null);
      return;
    }
    setEditorMode(leftEditor.mode);
    setActiveEvent(event);
    setActiveSeriesKey(event ? eventSeriesKey(event) : null);
    setCalendarCreateDay(leftEditor.day);
    setEventPlan(leftEditor.plan);
    /* eslint-enable react-hooks/set-state-in-effect */
    editorDialog.setOpen(true);
  }, [
    leftEditor,
    canMarkAttendance,
    canCreateEvents,
    eventWriteGate.allowed,
    eventsQuery.data,
    events,
    editorDialog,
    keptKeys,
  ]);

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

  // Tasks and birthdays on the agenda (#4144, #4959): the viewer's own tasks
  // on their due day, the ones they assigned, and members' shared birthdays.
  const calendarTasks = useCalendarTasks();
  const rosterQuery = useChapterRoster();
  const todayStart = startOfDay(new Date(nowTick));
  const todayKey = localIsoDate(todayStart);
  const anchor = (anchorKey ? dateOfKey(anchorKey) : null) ?? todayStart;
  const calendarBirthdays = useCalendarBirthdays(anchor);
  // The colour key's kinds switched off, remembered per user on this
  // browser (#5560); `null` until read, which shows everything.
  const [storedHidden, setStoredHidden] = useState<Set<CalendarKind> | null>(
    null,
  );
  const [hiddenReadFor, setHiddenReadFor] = useState<string | null>(null);
  if (userId && hiddenReadFor !== userId) {
    setHiddenReadFor(userId);
    setStoredHidden(readHiddenKinds(userId));
  }
  const hiddenKinds: ReadonlySet<CalendarKind> = useMemo(
    () => storedHidden ?? new Set(),
    [storedHidden],
  );
  function toggleKind(kind: CalendarKind) {
    const next = new Set(hiddenKinds);
    if (next.has(kind)) next.delete(kind);
    else next.add(kind);
    setStoredHidden(next);
    writeHiddenKinds(userId, next);
  }
  const nameOf = useMemo(() => {
    const names = new Map(
      (rosterQuery.data ?? []).map((member) => [
        member.user_id,
        member.display_name,
      ]),
    );
    return (memberUserId: string) =>
      memberUserId === userId
        ? "you"
        : memberLabel(names.get(memberUserId), memberUserId);
  }, [rosterQuery.data, userId]);

  const requiredOf = useRequiredOfViewer();

  // Search text, attendance policy, cadence. Time (upcoming/past/all) is
  // not here: the navigator's dots and the hour grid show every day's
  // events, whatever the agenda's window.
  const matchesNonTimeFilters = useCallback(
    (event: EventRow) => {
      const queryLower = query.trim().toLowerCase();
      const name = String(event.name ?? "").toLowerCase();
      const location = String(event.location ?? "").toLowerCase();
      // A meeting of a series, head or generated. Only the head carries the
      // rule, so reading `recurrence_rule` alone filed every generated
      // occurrence as one-time.
      const isRecurring = isSeriesEvent(event);
      // Required of this viewer, as the row says (#4132).
      const isMandatory = requiredOf(attendanceFieldsOf(event));

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
    [query, attendanceFilter, recurrenceFilter, requiredOf],
  );

  const calendarEvents = useMemo(
    () => events.filter(matchesNonTimeFilters),
    [events, matchesNonTimeFilters],
  );

  // Tasks and birthdays the search and filters leave: search matches their
  // titles, and the attendance and cadence filters, which only an event can
  // answer, leave none.
  const agendaItems = useMemo<CalendarItem[]>(() => {
    if (attendanceFilter !== "all" || recurrenceFilter !== "all") return [];
    const queryLower = query.trim().toLowerCase();
    const byDay = calendarTasksByDay(
      [...calendarTasks.items, ...calendarBirthdays],
      ALL_CALENDAR_LAYERS,
    );
    return [...byDay.values()]
      .flat()
      .filter(
        (item) => !queryLower || item.title.toLowerCase().includes(queryLower),
      );
  }, [
    calendarTasks.items,
    calendarBirthdays,
    query,
    attendanceFilter,
    recurrenceFilter,
  ]);

  // Upcoming lists from the agenda's first day on, Past back from now, All
  // everything. Soonest first, except Past, which reads back from the
  // latest. A start that can't be read sorts last.
  const anchorMs = anchor.getTime();
  // The day after the anchor, by the calendar: 24 hours lands on 11 PM or
  // 1 AM across a daylight-saving change.
  const dayAfterAnchorMs = addDays(anchor, 1).getTime();
  const filteredEvents = useMemo(() => {
    const now = nowTick;
    const inWindow = calendarEvents.filter((event) => {
      if (timeFilter === "all") return true;
      const start = startMsOf(event);
      // An event whose start cannot be read is shown under "upcoming" and
      // hidden under "past": it may still be ahead, and hiding it everywhere
      // would lose the row rather than mis-sort it.
      if (start === null) return timeFilter === "upcoming";
      if (timeFilter === "upcoming") return start >= anchorMs;
      return start < Math.min(now, dayAfterAnchorMs);
    });
    const direction = timeFilter === "past" ? -1 : 1;
    return inWindow.sort((a, b) => {
      const aStart = startMsOf(a);
      const bStart = startMsOf(b);
      if (aStart === null) return bStart === null ? 0 : 1;
      if (bStart === null) return -1;
      return (aStart - bStart) * direction;
    });
  }, [calendarEvents, timeFilter, nowTick, anchorMs, dayAfterAnchorMs]);

  // One row per repeating series, its next meeting (#3707); meetings that
  // already happened stay rows of their own.
  const agendaEntries = useMemo(
    () => collapseSeries(filteredEvents, nowTick),
    [filteredEvents, nowTick],
  );

  const agenda = useMemo(
    () =>
      buildAgenda({
        entries: agendaEntries,
        items: agendaItems,
        startOf: (event: EventRow) => event.start_time,
        keyOf: eventIdOf,
        anchor,
        direction: timeFilter === "past" ? -1 : 1,
        spanDays,
        // Today always heads Upcoming and All; under Past, a picked day does.
        forceAnchor: timeFilter !== "past" || anchorKey !== null,
        eventsBeforeAnchor: timeFilter === "all",
        overdueBefore: timeFilter === "upcoming" ? todayKey : undefined,
        hidden: hiddenKinds,
      }),
    // `anchor` is derived from `anchorKey` and today, both listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      agendaEntries,
      agendaItems,
      anchorKey,
      todayKey,
      timeFilter,
      spanDays,
      hiddenKinds,
    ],
  );

  // The hour grid's tasks and birthdays by day, less what the key hides.
  const gridItemsByDay = useMemo(
    () =>
      calendarTasksByDay(
        agendaItems.filter((item) => !hiddenKinds.has(calendarKindOf(item))),
        ALL_CALENDAR_LAYERS,
      ),
    [agendaItems, hiddenKinds],
  );

  // The navigator's dots: every day's kinds, the same rows the agenda would
  // list there, less what the key switched off.
  const dotsByDay = useMemo(
    () =>
      kindsByDay(
        calendarEvents,
        (event: EventRow) => event.start_time,
        agendaItems,
        hiddenKinds,
      ),
    [calendarEvents, agendaItems, hiddenKinds],
  );

  // Brings a picked day's heading into view once it has rendered.
  useEffect(() => {
    if (!scrollTarget) return;
    const node = document.getElementById(`events-day-${scrollTarget.key}`);
    if (node && typeof node.scrollIntoView === "function") {
      node.scrollIntoView({ block: "start", behavior: "smooth" });
    }
  }, [scrollTarget]);

  /**
   * Shows `day` on the agenda: scrolls to its heading when the agenda lists
   * anything there, else starts the agenda on it, so its heading shows,
   * saying so when it's empty. Today always brings the agenda back to
   * today. The span Show more reached stays.
   */
  function showDayOnAgenda(day: Date) {
    const key = localIsoDate(day);
    if (key === todayKey) {
      if (anchorKey !== null) setAnchorKey(null);
    } else if (!agenda.dayKeys.has(key)) {
      setAnchorKey(key);
    }
    setScrollTarget((target) => ({ key, count: (target?.count ?? 0) + 1 }));
  }

  /** The navigator's Today: its month or week, and the agenda, back home. */
  function goToToday() {
    setNavMonth(null);
    setStripStartKey(null);
    setPickedKey(null);
    if (hoursDay) {
      setHoursDay(todayStart);
      return;
    }
    showDayOnAgenda(todayStart);
  }

  function pickDay(day: Date) {
    setPickedKey(localIsoDate(day));
    // On the hour grid, a picked day moves the grid there.
    if (hoursDay) {
      setHoursDay(startOfDay(day));
      return;
    }
    showDayOnAgenda(day);
  }

  function leaveHours() {
    const day = hoursDay;
    setHoursDay(null);
    setHoursSingle(false);
    if (day) showDayOnAgenda(day);
  }

  const calendarCreateDefaults = useMemo(() => {
    if (!calendarCreateDay) return null;
    const start = new Date(calendarCreateDay);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    return {
      startAt: isoToLocalInput(start.toISOString()),
      endAt: isoToLocalInput(end.toISOString()),
    };
  }, [calendarCreateDay]);

  // What a select-all reaches: the event rows on screen.
  const visibleEventIds = agenda.blocks.flatMap((block) =>
    block.type === "day"
      ? block.day.rows.flatMap((row) =>
          row.kind === "events" ? [eventIdOf(row.entry.event)] : [],
        )
      : [],
  );
  // Only what is on screen counts: a row a filter, a search, the colour key
  // or the agenda's window hides keeps its tick for when it comes back, but
  // the count and the bulk action never reach it, so nothing is marked that
  // the officer can't see.
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
              message: `Check-in hasn't closed yet; it closes ${formatRelativeDayTime(closesAt, now)}.`,
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

  const eventWriteControls = eventWriteGate.controlProps();
  const searchText = query.trim();
  // The attendance and cadence filters narrow by kind. Time alone narrows by
  // when, and its miss gets its own line, since the default (Upcoming) hides
  // every past event without the officer having touched a filter.
  const narrowedByKind =
    attendanceFilter !== "all" || recurrenceFilter !== "all";
  const hasEvents = events.length > 0;
  const shownCount = visibleEventIds.length;
  const nowDate = new Date(nowTick);

  // The Filter menu's rows, also drawn as the chips of the filters that are
  // on. Upcoming is Time's resting value, so it counts as no filter.
  const eventFilters: FilterMenuFilter[] = [
    {
      key: "time",
      label: "Time",
      options: TIME_OPTIONS,
      value: timeFilter,
      anyValue: "upcoming",
      onChange: (value) => setTimeFilter(value as TimeFilter),
    },
    {
      key: "attendance",
      label: "Attendance",
      options: ATTENDANCE_OPTIONS,
      value: attendanceFilter,
      anyValue: "all",
      onChange: (value) => setAttendanceFilter(value as AttendanceFilter),
    },
    {
      key: "cadence",
      label: "Cadence",
      options: CADENCE_OPTIONS,
      value: recurrenceFilter,
      anyValue: "all",
      onChange: (value) => setRecurrenceFilter(value as CadenceFilter),
    },
  ];

  // The "No events match these filters" line's Clear filters: only the kind
  // filters it blames. Time stays, so an officer working in Past stays there.
  function clearKindFilters() {
    setAttendanceFilter("all");
    setRecurrenceFilter("all");
  }

  // An hour of the hour grid starts then.
  function openCreate(day: Date | null, startHour?: number) {
    const start = day ? calendarCreateStart(day, startHour) : null;
    setEditorMode("create");
    setActiveEvent(null);
    setActiveSeriesKey(null);
    setCalendarCreateDay(start);
    setEventPlan(null);
    keepEditorOpen({ mode: "create", event: null, plan: null, day: start });
    editorDialog.setOpen(true);
  }

  // "This time last year" (#3930): the same form, opened as a copy of last
  // year's event on the same weekday this year.
  function openPlan(plan: EventPlan) {
    setEditorMode("create");
    setActiveEvent(null);
    setActiveSeriesKey(null);
    setCalendarCreateDay(null);
    setEventPlan(plan);
    keepEditorOpen({ mode: "create", event: null, plan, day: null });
    editorDialog.setOpen(true);
  }

  // Any meeting of a series opens with its series, from an agenda row, a
  // past row or the hour grid: the sheet then has the head's rule (a
  // generated meeting carries none) and the series' upcoming meetings.
  function openDetails(event: EventRow, linked = { excuse: false }) {
    setExcuseAsk((ask) =>
      linked.excuse
        ? { eventId: eventIdOf(event), count: (ask?.count ?? 0) + 1 }
        : null,
    );
    setActiveEvent(event);
    setActiveSeriesKey(eventSeriesKey(event));
    setDetailSheetOpen(true);
  }

  function renderEventRow(entry: Entry): ReactNode {
    const { event, series } = entry;
    const eventId = eventIdOf(event);
    const eventName = String(event.name ?? "Untitled event");
    const fields = attendanceFieldsOf(event);
    // Required of this viewer, by default or by a role of theirs, as the
    // phone says it (#4132, `spec/behavior/events.md`): the loudest row
    // (#5560). An event that sets roles apart also says so with a badge.
    const isRequired = requiredOf(fields);
    const isTargeted = eventSetsRolesApart(fields);
    // A series says how it repeats after its name, muted, as the phone's row
    // does ("Chapter · Every Sunday"). The day heading above says which day,
    // so the meta line starts at the time.
    const cadence = series ? seriesCadenceOf(events, event) : null;
    // Start to end, "7:00 – 9:00 PM", as the phone's row says it: a member
    // deciding whether to go wants to know when it lets out (2026-11-19).
    const time = formatTimeRange(event.start_time, event.end_time, nowDate);
    // Said on the row while it lasts, as the phone's row says it, so a member
    // walking in sees where to check in without opening the event.
    const checkInOpen = checkInOpenNow(
      event.start_time,
      event.end_time,
      event.check_in_opens_minutes,
      nowTick,
    );
    // One derived value: the row fill and the checkbox must never disagree
    // about whether the row is selected.
    const isSelected = selecting && selectedIdSet.has(eventId);
    const location =
      typeof event.location === "string" && event.location.trim()
        ? event.location.trim()
        : null;
    // An absent fact drops out of the line rather than reading "TBD" or "0".
    const meta = [time, location, pointsLabel(event.point_value)]
      .filter(Boolean)
      .join(" · ");
    const hue = EVENT_HUE;
    return (
      <li
        key={`event:${eventId}`}
        // The wash and a required event's edge span the whole row, its
        // selection slot inside the box.
        style={isSelected ? undefined : eventKindStyle(isRequired)}
        className={cn(
          "flex items-center gap-1 rounded-md border border-transparent transition-[filter] hover:brightness-125",
          // Fill means state, never striping.
          isSelected && "bg-popover",
        )}
      >
        {/*
          The row is the control: it opens the event's details. Its accessible
          name is its own text, so it always says exactly what the row shows.
          Its kind is its colour: a sky bar and wash, as the navigator's dot
          and the colour key draw events.
        */}
        <button
          type="button"
          data-kind="events"
          data-required={isRequired || undefined}
          onClick={() => openDetails(event)}
          className={cn(AGENDA_ROW_CLASS, "min-w-0 flex-1", FOCUS_RING_OFFSET)}
        >
          <AgendaMarkSlot>
            <span
              data-testid="agenda-mark"
              data-hue={hue}
              className="w-1 self-stretch rounded-full"
              style={{ backgroundColor: hue }}
            />
          </AgendaMarkSlot>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="flex min-w-0 items-baseline gap-2">
              <span className="truncate text-sm font-semibold text-foreground">
                {eventName}
                {cadence ? (
                  <span className="font-normal text-muted-foreground">
                    {` · ${cadence}`}
                  </span>
                ) : null}
              </span>
              {isRequired ? (
                <span
                  className="shrink-0 text-caption font-semibold"
                  style={{ color: hue }}
                >
                  Required
                </span>
              ) : null}
            </span>
            {meta ? (
              <span className="truncate text-caption text-muted-foreground">
                {meta}
              </span>
            ) : null}
            {checkInOpen ? (
              <span className="text-caption font-semibold text-success">
                {CHECK_IN_OPEN_LABEL}
              </span>
            ) : null}
          </span>
          {isTargeted ? (
            <Badge variant="outline" className="shrink-0 gap-1">
              <RolesGlyph className="h-3.5 w-3.5" />
              By role
            </Badge>
          ) : null}
        </button>
        {selectionCell(
          selecting ? (
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
          ) : null,
        )}
      </li>
    );
  }

  /*
   * The selection column is reserved whenever this viewer can bulk-mark, in
   * or out of Select and on every kind of row, so entering the mode or
   * checking a row moves nothing (#3822).
   */
  function selectionCell(content: ReactNode): ReactNode {
    return canMarkAttendance ? (
      <span className="flex w-11 shrink-0 items-center justify-center">
        {content}
      </span>
    ) : null;
  }

  function renderAgendaRow(row: AgendaRow<EventRow>): ReactNode {
    if (row.kind === "events") return renderEventRow(row.entry);
    return (
      <li key={row.key} className="flex items-center gap-1">
        <div className="min-w-0 flex-1">
          {row.kind === "tasks" ? (
            <AgendaTaskRow item={row.task} nameOf={nameOf} />
          ) : (
            <AgendaBirthdayRow item={row.birthday} />
          )}
        </div>
        {selectionCell(null)}
      </li>
    );
  }

  function renderDay(day: AgendaDay<EventRow>): ReactNode {
    const heading = day.date
      ? (formatDayHeading(day.date, nowDate) ?? "Date not set")
      : "Date not set";
    const headingId = `events-day-${day.key}-label`;
    const dayDate = day.date;
    return (
      <div
        key={day.key}
        id={`events-day-${day.key}`}
        role="group"
        aria-labelledby={headingId}
        className="scroll-mt-4"
      >
        <div className="flex items-center gap-2 px-2 pb-1 pt-3">
          <h3
            id={headingId}
            className="min-w-0 flex-1 text-caption font-semibold text-foreground"
          >
            {heading}
          </h3>
          {dayDate ? (
            // Quiet: the hour grid is a way in, not a second view.
            <button
              type="button"
              aria-label={`Hours for ${heading}`}
              onClick={() => {
                setPickedKey(day.key);
                setHoursSingle(false);
                setHoursDay(dayDate);
              }}
              className={cn(
                "flex min-h-7 items-center gap-0.5 rounded-md px-1.5 text-caption font-semibold text-muted-foreground transition-colors hover:bg-card-hover hover:text-foreground pointer-coarse:min-h-11",
                FOCUS_RING_OFFSET,
              )}
            >
              Hours
              <ChevronRight aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
        {day.rows.length === 0 ? (
          <p className="px-2 pb-1 text-caption text-muted-foreground">
            {nothingOn(heading)}
          </p>
        ) : (
          /*
            `role="list"` restored explicitly: `display:flex` on an `<li>`
            drops its list-item box, and WebKit then stops exposing the list.
          */
          <ul role="list" className={cn(denseListClassName, "space-y-1")}>
            {day.rows.map(renderAgendaRow)}
          </ul>
        )}
      </div>
    );
  }

  const navigatorMonth = navMonth ?? todayStart;
  // The navigator's Today shows only once something has moved off today.
  const showTodayButton =
    anchorKey !== null ||
    pickedKey !== null ||
    stripStartKey !== null ||
    (navMonth !== null &&
      (navMonth.getFullYear() !== todayStart.getFullYear() ||
        navMonth.getMonth() !== todayStart.getMonth()));
  const stripStart =
    (stripStartKey ? dateOfKey(stripStartKey) : null) ?? todayStart;
  const kindKey = (
    <KindKey
      hidden={hiddenKinds}
      counts={agenda.counts}
      onToggle={toggleKind}
      compact={narrow}
    />
  );

  return (
    // A container (#4022): beside chat (#3779) the page is narrow while the
    // window is wide, so its toolbar and rows break on the page's own width
    // (`@xl`, 576px), not the viewport's.
    <div className="@container space-y-4">
      {/*
        The toolbar recedes to the title row's trailing side (#5560): search,
        the one Filter button, Subscribe (#3322), and New event, the page's one
        primary action, outlined in the accent rather than filled, so the
        agenda is what the eye lands on. The route's title is in the top bar
        (`top-bar.tsx`). On a narrow pane (beside chat, the width that swaps
        the month for the week strip) search, Filter and Subscribe are glyphs,
        so the whole toolbar is one row; search opens into its field when
        pressed and closes again on Escape or blur while empty.
      */}
      <PageActions className={cn("gap-x-2 gap-y-2", narrow && "flex-nowrap")}>
        {narrow && !searchOpen && !query ? (
          <IconButton
            variant="secondary"
            className="shrink-0"
            label="Search events"
            onClick={() => setSearchOpen(true)}
          >
            <SearchGlyph className="h-4 w-4" />
          </IconButton>
        ) : (
          <div
            className={cn(
              "relative min-w-0 flex-1",
              !narrow && "basis-full @xl:max-w-56 @xl:basis-auto",
            )}
          >
            <SearchGlyph className={dashboardToolbarSearchGlyphClassName} />
            <Input
              type="search"
              value={query}
              autoFocus={narrow && searchOpen}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !query) setSearchOpen(false);
              }}
              onBlur={() => {
                if (!query) setSearchOpen(false);
              }}
              placeholder="Search events"
              aria-label="Search events by name or location"
              className={dashboardToolbarSearchClassName}
            />
          </div>
        )}
        <FilterMenu filters={eventFilters} thing="events" narrow={narrow} />
        <CalendarSubscribeMenu iconOnly={narrow} />
        <Can allOf={EVENT_CREATE_PERMISSIONS}>
          <NewButton
            thing="event"
            {...eventWriteControls}
            onClick={() => openCreate(null)}
          />
        </Can>
      </PageActions>
      <ActiveFilterChips filters={eventFilters} />

      {/*
        Under the row it explains. Search and the filters stay live: a lapsed
        chapter keeps full visibility of its own calendar.
      */}
      <SubscriptionNotice
        gate={eventWriteGate}
        feature="creating and editing events"
      />

      {/*
        What the chapter held around now last year and hasn't planned (#3930).
        The server lists these only to officers who can edit events (#4549);
        the section also needs Create events, since its answer is the event
        form. Nothing waiting draws nothing.
      */}
      {canCreateEvents ? (
        <SuggestedEvents
          headingId="events-last-year"
          onPlan={openPlan}
          disabled={eventWriteControls.disabled}
        />
      ) : null}

      <div
        ref={layoutRef}
        // Until the pane is measured it draws the wide layout, which wraps:
        // the agenda keeps at least 320px and drops under the navigator
        // rather than squeezing past a 375px pane (beside-chat floor).
        className={cn(
          "flex gap-6",
          narrow ? "flex-col gap-3" : "flex-wrap items-start",
        )}
      >
        {narrow ? (
          <div className="space-y-1">
            <WeekStrip
              start={stripStart}
              onToday={showTodayButton ? goToToday : undefined}
              onStartChange={(next) =>
                setStripStartKey(
                  localIsoDate(next) === todayKey ? null : localIsoDate(next),
                )
              }
              todayKey={todayKey}
              pickedKey={pickedKey}
              dots={dotsByDay}
              onPick={pickDay}
            />
            {kindKey}
          </div>
        ) : (
          // Beside the agenda, and stays in view while it scrolls.
          <aside
            aria-label="Navigator"
            className="sticky top-0 w-[260px] shrink-0 space-y-3"
          >
            <MiniMonth
              month={navigatorMonth}
              onToday={showTodayButton ? goToToday : undefined}
              onMonthChange={setNavMonth}
              todayKey={todayKey}
              pickedKey={pickedKey}
              dots={dotsByDay}
              onPick={pickDay}
            />
            {kindKey}
          </aside>
        )}

        <div className={cn("min-w-0 flex-1", !narrow && "basis-80")}>
          {hoursDay ? (
            /*
              The hour grid (#4818), reached from a day heading's Hours: that
              day and the two after it, or the day alone on a narrow pane.
              Back returns to the agenda on the same day.
            */
            <section aria-labelledby="events-hours-label" className="space-y-3">
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="toolbar"
                  className="gap-1 px-2"
                  onClick={leaveHours}
                >
                  <ChevronLeft aria-hidden="true" className="h-4 w-4" />
                  Events
                </Button>
                <h2
                  id="events-hours-label"
                  className="min-w-0 flex-1 truncate text-sm font-semibold"
                >
                  {formatDayHeading(hoursDay, nowDate) ?? "Hours"}
                </h2>
              </div>
              <EventsTimeGrid
                days={consecutiveDays(hoursDay, narrow || hoursSingle ? 1 : 3)}
                events={hiddenKinds.has("events") ? [] : calendarEvents}
                tasksByDay={gridItemsByDay}
                nameOf={nameOf}
                factsOf={(event) => calendarEventFacts(event, requiredOf)}
                onSelectEvent={(event) => openDetails(event)}
                // A column's heading opens that day alone, whose hours are
                // the keyboard's way to make an event at one.
                onOpenDay={(day) => {
                  setHoursDay(startOfDay(day));
                  setHoursSingle(true);
                }}
                onCreateAt={(day, hour) => openCreate(day, hour)}
                canCreate={canCreateEvents}
                createDisabled={Boolean(eventWriteControls.disabled)}
                createDescribedBy={eventWriteControls["aria-describedby"]}
                createTitle={eventWriteControls.title}
              />
            </section>
          ) : (
            /*
              One agenda (#5560): the days in order from the anchor, each
              day's events, tasks and birthdays together. A miss among the
              events says which kind of miss it is and offers the way back
              out (`writing.md` §7); the days under it still list the rest.
            */
            <section aria-labelledby="events-list-label">
              {/*
                The agenda's header. Select swaps its trailing controls in
                place, and the select-all sits in the rows' reserved selection
                column, so nothing above or beside the rows moves (#3822).
                Notify assignees and Archive selected were removed rather than
                wired (#336): events have no assignee concept and no archive
                state.
              */}
              <div className="flex min-h-9 items-center gap-1 pointer-coarse:min-h-11">
                <div className="min-w-0 flex-1 px-2">
                  <SectionLabel
                    id="events-list-label"
                    count={
                      selecting
                        ? `${selectedVisibleIds.length} selected`
                        : eventsCount(shownCount)
                    }
                  >
                    {TIME_FILTER_LABELS[timeFilter]}
                  </SectionLabel>
                </div>
                {/*
                  Once in Select, its controls stay until Done, even when no
                  row is on screen (a search emptied the agenda), so the mode
                  always has a way out.
                */}
                {canMarkAttendance && (selecting || shownCount > 0) ? (
                  selecting ? (
                    <>
                      <Button
                        size="toolbar"
                        variant="secondary"
                        {...eventWriteGate.controlProps(
                          autoAbsent.isPending ||
                            selectedVisibleIds.length === 0,
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
              ) : null}
              {agenda.blocks.map((block) =>
                block.type === "day" ? (
                  renderDay(block.day)
                ) : block.type === "overdue" ? (
                  <div
                    key="overdue"
                    id="events-day-overdue"
                    role="group"
                    aria-labelledby="events-day-overdue-label"
                  >
                    <h3
                      id="events-day-overdue-label"
                      className="px-2 pb-1 pt-3 text-caption font-semibold text-destructive-text"
                    >
                      Overdue
                    </h3>
                    <ul
                      role="list"
                      className={cn(denseListClassName, "space-y-1")}
                    >
                      {block.rows.map(renderAgendaRow)}
                    </ul>
                  </div>
                ) : (
                  <p
                    key="quiet-week"
                    className="px-2 pt-3 text-caption text-muted-foreground"
                  >
                    {stateMicrocopy.events.nothingThisWeek}
                  </p>
                ),
              )}
              {agenda.hasMore ? (
                <div className="px-2 pt-3">
                  <Button
                    size="toolbar"
                    variant="ghost"
                    onClick={() =>
                      setSpanDays((days) => days + AGENDA_SPAN_DAYS)
                    }
                  >
                    Show more
                  </Button>
                </div>
              ) : null}
            </section>
          )}
        </div>
      </div>

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
        onSelectOccurrence={(occurrence) => {
          setExcuseAsk(null);
          setActiveEvent(occurrence);
        }}
        usingPreviewData={false}
        excuseAsk={excuseAsk}
        onRequestEdit={(event) => {
          setActiveEvent(event);
          setDetailSheetOpen(false);
          setEditorMode("edit");
          keepEditorOpen({ mode: "edit", event, plan: null, day: null });
          editorDialog.setOpen(true);
        }}
        onEventDeleted={async () => {
          await eventsQuery.refetch();
        }}
        docked
      />

      <EventEditorDialog
        open={editorDialog.open}
        onOpenChange={(open) => {
          editorDialog.setOpen(open);
          // Closed from inside the page: coming back opens the page, not the
          // form. Its draft, if any, waits for the form to open again.
          if (!open) keepEditorOpen(null);
          // Edit opened from the event's own view, so leaving it (Back,
          // Cancel or Save) goes back there, as Google Calendar does.
          // Unless a series save rebuilt or moved it: its id may be gone,
          // and the list is where the change shows.
          if (
            !open &&
            editorMode === "edit" &&
            activeEvent &&
            !leftEditedEvent.current
          ) {
            setDetailSheetOpen(true);
          }
          leftEditedEvent.current = false;
        }}
        onCloseAutoFocus={editorDialog.contentProps.onCloseAutoFocus}
        mode={editorMode}
        docked
        backLabel={editorMode === "edit" ? "Back to event" : "Back to events"}
        event={activeEvent}
        usingPreviewData={false}
        initialStartAt={eventPlan?.startAt ?? calendarCreateDefaults?.startAt}
        initialEndAt={eventPlan?.endAt ?? calendarCreateDefaults?.endAt}
        template={eventPlan?.template}
        keptDraft={editorDraftName}
        onCreated={async (eventId) => {
          if (eventPlan) {
            await recordPlannedEvent(eventPlan.suggestionId, eventId);
          }
        }}
        onSaved={async () => {
          await eventsQuery.refetch();
        }}
        onLeftEvent={() => {
          leftEditedEvent.current = true;
        }}
      />
      {confirmDialog}
    </div>
  );
}
