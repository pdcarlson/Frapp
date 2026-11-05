"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  EventsGlyph,
  RolesGlyph,
  SearchGlyph,
} from "@/components/events/chapter-ops-glyphs";
import {
  useAutoAbsent,
  useEvents,
  useMyPermissions,
  useNow,
} from "@repo/hooks";
import { can } from "@repo/validation";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { anyReadUncached } from "@/components/shared/async-states";
import {
  NestedEmpty,
  NestedError,
  NestedLoading,
  NestedOffline,
} from "@/components/shared/nested-states";
import { SectionLabel } from "@/components/shared/section-label";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
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
import { pointsLabel, recurrenceLabel } from "@/components/events/event-labels";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { formatRelativeDayTime, parseInstant } from "@repo/formatting";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { cn, getErrorMessage } from "@/lib/utils";

type EventRow = Record<string, unknown>;

// A day click carries no time of day, so the create form opens with a
// reasonable default slot (6-7pm) rather than midnight-to-midnight.
const CALENDAR_DEFAULT_START_HOUR = 18;

type TimeFilter = "upcoming" | "past" | "all";

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

export function EventsPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("upcoming");
  const [view, setView] = useState<"list" | "calendar">("list");
  const [attendanceFilter, setAttendanceFilter] = useState<
    "all" | "mandatory" | "optional"
  >("all");
  const [recurrenceFilter, setRecurrenceFilter] = useState<
    "all" | "recurring" | "one-time"
  >("all");
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  // `POST /v1/events` and `PATCH /v1/events/:id` are paid-ops, so the editor's
  // entry points mirror the gate (#841). Routing the dialog through
  // `useGatedDialog` covers all three of them at once — the New event button,
  // the empty-state CTA, and the detail sheet's Edit — and closes the dialog if
  // the subscription lapses while it is open.
  const eventWriteGate = useSubscriptionGate();
  const editorDialog = useGatedDialog(eventWriteGate);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [activeEvent, setActiveEvent] = useState<EventRow | null>(null);
  // Set only by a calendar day click, so the "New event" button and the
  // empty-state CTA keep opening a blank form exactly as they do today.
  const [calendarCreateDay, setCalendarCreateDay] = useState<Date | null>(null);
  // Lifted here (not local to EventsCalendar) because the Calendar tab's
  // content unmounts on tab switch — see EventsCalendar's own comment.
  const [calendarMonthAnchor, setCalendarMonthAnchor] = useState<Date>(() =>
    startOfMonth(new Date()),
  );
  const eventsQuery = useEvents();
  const autoAbsent = useAutoAbsent();
  // The bulk action posts auto-absent, which is `events:update` and paid-ops
  // on the server, as in the attendance panel. A role without it gets no
  // checkboxes at all, and a lapsed chapter's button explains itself. Read as
  // a boolean rather than a `<Can>`: the checkboxes are a column on every
  // row, and nothing here has a recovery path to offer while offline.
  const { data: permissionsPayload } = useMyPermissions();
  const canMarkAttendance = can(
    "events:update",
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
      const recurrenceRule =
        typeof event.recurrence_rule === "string" ? event.recurrence_rule : "";
      const isRecurring = recurrenceRule.length > 0;
      const isMandatory =
        typeof event.is_mandatory === "boolean" ? event.is_mandatory : false;

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

  const filteredEvents = useMemo(() => {
    const now = nowTick;
    return calendarEvents.filter((event) => {
      if (timeFilter === "all") return true;
      const start = parseInstant(event.start_time);
      // An event whose start cannot be read is shown under "upcoming" and
      // hidden under "past": it may still be ahead, and hiding it everywhere
      // would lose the row rather than mis-sort it.
      if (!start) return timeFilter === "upcoming";
      const startMs = start.getTime();
      if (timeFilter === "upcoming" && startMs < now) return false;
      if (timeFilter === "past" && startMs >= now) return false;
      return true;
    });
  }, [calendarEvents, timeFilter, nowTick]);
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

  const visibleEventIds = filteredEvents.map((event) =>
    String(event.id ?? event.name ?? ""),
  );
  const allVisibleSelected =
    visibleEventIds.length > 0 &&
    visibleEventIds.every((eventId) => selectedEventIds.includes(eventId));

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

  // `POST /events/:id/attendance/auto-absent` is real, guarded, per-event
  // support for this action — it records ABSENT for whoever the event
  // required and never checked in or was otherwise marked. It refuses (400)
  // before an event's check-in grace period ends, so a batch spanning an
  // in-progress event fails that event without blocking the rest.
  async function markSelectedAttendanceComplete() {
    const ids = [...selectedEventIds];
    if (ids.length === 0) return;
    const confirmed = await confirm({
      title: `Mark attendance complete for ${ids.length} event${ids.length > 1 ? "s" : ""}?`,
      description:
        "Members who didn't check in and weren't otherwise marked will be recorded absent. This cannot be undone.",
      confirmLabel: "Mark attendance complete",
    });
    if (!confirmed) return;

    const results = await Promise.allSettled(
      ids.map((eventId) => autoAbsent.mutateAsync(eventId)),
    );
    // `results` is positionally aligned with `ids`, which is the only way to
    // name which event failed — `Promise.allSettled` itself carries no id.
    const failures = results.flatMap((result, index) =>
      result.status === "rejected"
        ? [{ eventId: ids[index]!, reason: result.reason }]
        : [],
    );
    const succeeded = results.length - failures.length;

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
      setSelectedEventIds([]);
    } else {
      const eventName = (eventId: string) =>
        String(
          events.find(
            (event) => String(event.id ?? event.name ?? "") === eventId,
          )?.name ?? eventId,
        );
      const detail = failures
        .map(
          ({ eventId, reason }) =>
            `${eventName(eventId)}: ${getErrorMessage(reason, "unknown error")}`,
        )
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
    return (
      <div className="space-y-4">
        <NestedLoading sole message={stateMicrocopy.events.loading} />
      </div>
    );
  }

  if (eventsQuery.isError) {
    return (
      <div className="space-y-4">
        <NestedError
          sole
          title={stateMicrocopy.events.errorTitle}
          description={stateMicrocopy.events.errorDescription}
          onRetry={() => void eventsQuery.refetch()}
        />
      </div>
    );
  }

  const eventWriteControls = eventWriteGate.controlProps();
  const searchText = query.trim();
  const narrowed =
    timeFilter !== "all" ||
    attendanceFilter !== "all" ||
    recurrenceFilter !== "all";

  function openCreate(day: Date | null) {
    setEditorMode("create");
    setActiveEvent(null);
    setCalendarCreateDay(day);
    editorDialog.setOpen(true);
  }

  function openDetails(event: EventRow) {
    setActiveEvent(event);
    setDetailSheetOpen(true);
  }

  return (
    <Tabs
      value={view}
      onValueChange={(next) => setView(next as "list" | "calendar")}
      className="space-y-4"
    >
      {/*
        One toolbar row: search, the three filters, the List/Calendar toggle
        and New event, all at the toolbar height (board `1f` pin 2). The
        filters used to sit in a second row and the toggle in a third. The
        route's title is in the top bar (`top-bar.tsx`), so the row has no
        heading: search and filters hold the leading edge (`sm:mr-auto`) and
        the toggle and New event sit at the trailing edge, as every route's
        actions do (`page-actions.tsx`).

        It is its own row rather than `PageActions`, so a phone can reorder
        it: there the first line keeps the view toggle and New event, and
        search and the filters drop to their own rows under it. The filters
        become one strip that scrolls sideways, bleeding to the screen edges,
        rather than three stacked rows of selects.
      */}
      <div className="flex min-h-[34px] flex-wrap items-center justify-end gap-x-3 gap-y-2">
        <div className="order-last flex w-full min-w-0 flex-wrap items-center gap-2 sm:order-none sm:mr-auto sm:w-auto">
          <div className="relative w-full sm:w-56">
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
          <div className="-mx-4 flex w-[calc(100%+2rem)] gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:w-auto sm:overflow-visible sm:px-0">
            <select
              value={timeFilter}
              onChange={(event) =>
                setTimeFilter(event.target.value as TimeFilter)
              }
              className={`${dashboardFilterSelectClassName} shrink-0`}
              aria-label="Filter events by time window"
            >
              <option value="upcoming">Time: Upcoming</option>
              <option value="past">Time: Past</option>
              <option value="all">Time: All</option>
            </select>
            <select
              value={attendanceFilter}
              onChange={(event) =>
                setAttendanceFilter(
                  event.target.value as "all" | "mandatory" | "optional",
                )
              }
              className={`${dashboardFilterSelectClassName} shrink-0`}
              aria-label="Filter events by attendance policy"
            >
              <option value="all">Attendance: All</option>
              <option value="mandatory">Attendance: Mandatory</option>
              <option value="optional">Attendance: Optional</option>
            </select>
            <select
              value={recurrenceFilter}
              onChange={(event) =>
                setRecurrenceFilter(
                  event.target.value as "all" | "recurring" | "one-time",
                )
              }
              className={`${dashboardFilterSelectClassName} shrink-0`}
              aria-label="Filter events by cadence"
            >
              <option value="all">Cadence: All</option>
              <option value="recurring">Cadence: Recurring</option>
              <option value="one-time">Cadence: One-time</option>
            </select>
          </div>
        </div>
        {/*
          Underlined, not a segmented pill (`components.md` §6), and pulled
          down to the toolbar height. The list's own hairline is dropped: in
          a toolbar row the active item's underline is the only mark needed.
        */}
        <TabsList aria-label="View" className="w-auto gap-4 border-b-0">
          <TabsTrigger
            value="list"
            className="min-h-9 py-1.5 pointer-coarse:min-h-11"
          >
            List
          </TabsTrigger>
          <TabsTrigger
            value="calendar"
            className="min-h-9 py-1.5 pointer-coarse:min-h-11"
          >
            Calendar
          </TabsTrigger>
        </TabsList>
        <Button
          size="toolbar"
          className="gap-2"
          {...eventWriteControls}
          onClick={() => openCreate(null)}
        >
          <Plus className="h-4 w-4" />
          New event
        </Button>
      </div>

      {/*
        Under the row it explains. Search and the filters stay live: a lapsed
        chapter keeps full visibility of its own calendar.
      */}
      <SubscriptionNotice
        gate={eventWriteGate}
        feature="creating and editing events"
      />

      <TabsContent value="list" className="mt-0 space-y-3">
        {/*
          The selection bar, as a flush tinted strip rather than the accent
          `<Card>` it used to be. Only the count and the bulk action are
          conditional; select-all lives in the list header below, because a
          control inside this bar would unmount itself when it cleared the
          selection (`members-directory.tsx` has the full reasoning).

          Notify assignees and Archive selected were removed rather than wired
          (#336): events have no assignee concept and no archive state, only
          delete, so there is no real mutation to call without inventing one.
        */}
        {canMarkAttendance && selectedEventIds.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-accent-border bg-accent-subtle px-2 py-1.5">
            <p className="text-caption font-semibold text-accent-text">
              {selectedEventIds.length} selected
            </p>
            <Button
              size="toolbar"
              variant="secondary"
              className="sm:ml-auto"
              {...eventWriteGate.controlProps(autoAbsent.isPending)}
              onClick={() => void markSelectedAttendanceComplete()}
            >
              Mark attendance complete
            </Button>
          </div>
        ) : null}

        {filteredEvents.length === 0 ? (
          searchText ? (
            <NestedEmpty
              sole
              title={`No match for “${searchText}”`}
              description={stateMicrocopy.events.noMatchDescription}
            />
          ) : narrowed && events.length > 0 ? (
            // "No events yet" over a chapter whose events are all past (the
            // default filter is Upcoming) would tell the officer something
            // false (`writing.md` §7).
            <NestedEmpty
              sole
              title={stateMicrocopy.events.filteredTitle}
              description={stateMicrocopy.events.filteredDescription}
            />
          ) : (
            <NestedEmpty
              sole
              title={stateMicrocopy.events.emptyTitle}
              description={stateMicrocopy.events.emptyDescription}
              actionLabel="Create first event"
              actionProps={eventWriteControls}
              onAction={() => openCreate(null)}
            />
          )
        ) : (
          <section aria-labelledby="events-list-label">
            {/*
              The list header: all that survives of the deleted `<thead>`. The
              select-all leads, in line with every row's checkbox, beside the
              section label and its count.
            */}
            <div className="flex min-h-9 items-center gap-1 pointer-coarse:min-h-11">
              {canMarkAttendance ? (
                <label
                  className={`${dashboardCheckboxHitAreaClassName} shrink-0`}
                >
                  <input
                    type="checkbox"
                    aria-label="Select all visible events"
                    className={dashboardTableCheckboxClassName}
                    checked={allVisibleSelected}
                    onChange={(event) =>
                      toggleAllVisibleEvents(event.target.checked)
                    }
                  />
                </label>
              ) : null}
              <div className="min-w-0 px-2">
                <SectionLabel
                  id="events-list-label"
                  count={`${filteredEvents.length} event${filteredEvents.length === 1 ? "" : "s"}`}
                >
                  {TIME_FILTER_LABELS[timeFilter]}
                </SectionLabel>
              </div>
            </div>
            {/*
              `role="list"` restored explicitly: `display:flex` on an `<li>`
              drops its list-item box, and WebKit then stops exposing the list.
            */}
            <ul role="list" className={denseListClassName}>
              {filteredEvents.map((event) => {
                const eventId = String(
                  event.id ?? event.name ?? "unknown-event",
                );
                const eventName = String(event.name ?? "Untitled event");
                const isMandatory = event.is_mandatory === true;
                const cadence = recurrenceLabel(event.recurrence_rule);
                const isTargeted =
                  Array.isArray(event.required_role_ids) &&
                  event.required_role_ids.some((id) => typeof id === "string");
                // One derived value: the row fill and the checkbox must never
                // disagree about whether the row is selected.
                const isSelected = selectedEventIds.includes(eventId);
                const location =
                  typeof event.location === "string" && event.location.trim()
                    ? event.location.trim()
                    : null;
                // An absent fact drops out of the line rather than reading
                // "TBD" or "0".
                const meta = [
                  formatRelativeDayTime(event.start_time, new Date(nowTick)),
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
                      isSelected && "bg-accent-subtle-hover text-accent-text",
                    )}
                  >
                    {canMarkAttendance ? (
                      <label
                        className={`${dashboardCheckboxHitAreaClassName} shrink-0`}
                      >
                        <input
                          type="checkbox"
                          aria-label={`Select ${eventName}`}
                          className={dashboardTableCheckboxClassName}
                          checked={isSelected}
                          onChange={(eventValue) =>
                            toggleEventSelection(
                              eventId,
                              eventValue.target.checked,
                            )
                          }
                        />
                      </label>
                    ) : null}
                    {/*
                      The row is the control: it opens the event's details,
                      the job the trailing "View details" button did. Its
                      accessible name is its own text, so it always says
                      exactly what the row shows.
                    */}
                    <button
                      type="button"
                      onClick={() => openDetails(event)}
                      className={cn(
                        "flex min-h-11 min-w-0 flex-1 flex-col items-start gap-1 rounded-md px-2 py-1.5 text-left transition-colors sm:flex-row sm:items-center sm:gap-3",
                        !isSelected &&
                          "hover:bg-accent-subtle hover:text-foreground",
                        FOCUS_RING_OFFSET,
                      )}
                    >
                      <span className="flex min-w-0 max-w-full flex-col sm:flex-1">
                        <span className="truncate text-sm font-semibold">
                          {eventName}
                        </span>
                        {meta ? (
                          <span className="truncate text-caption text-muted-foreground">
                            {meta}
                          </span>
                        ) : null}
                      </span>
                      {isMandatory || cadence || isTargeted ? (
                        <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {isMandatory ? <Badge>Mandatory</Badge> : null}
                          {cadence ? (
                            <Badge variant="outline" className="gap-1">
                              <EventsGlyph className="h-3.5 w-3.5" />
                              {cadence}
                            </Badge>
                          ) : null}
                          {isTargeted ? (
                            <Badge variant="outline" className="gap-1">
                              <RolesGlyph className="h-3.5 w-3.5" />
                              Targeted
                            </Badge>
                          ) : null}
                        </span>
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </TabsContent>

      {/*
        Flush, with no card, title or description: the calendar names its own
        month, and a day number and an event chip say what they do.
      */}
      <TabsContent value="calendar" className="mt-0">
        <EventsCalendar
          events={calendarEvents}
          monthAnchor={calendarMonthAnchor}
          onMonthAnchorChange={setCalendarMonthAnchor}
          createDisabled={eventWriteControls.disabled}
          createDescribedBy={eventWriteControls["aria-describedby"]}
          createTitle={eventWriteControls.title}
          onSelectEvent={openDetails}
          onCreateOnDay={openCreate}
        />
      </TabsContent>

      <EventDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        event={activeEvent}
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
    </Tabs>
  );
}
