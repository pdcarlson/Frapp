"use client";

import { useCallback, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import {
  EventsGlyph,
  RolesGlyph,
  SearchGlyph,
} from "@/components/events/chapter-ops-glyphs";
import { useAutoAbsent, useEvents, useNow } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  EmptyState,
  ErrorState,
  anyReadUncached,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import {
  SubscriptionNotice,
  useGatedDialog,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  dashboardCheckboxCellClassName,
  dashboardCheckboxHitAreaClassName,
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/hooks/use-toast";
import { EventDetailSheet } from "@/components/events/event-detail-sheet";
import {
  EventEditorDialog,
  isoToLocalInput,
} from "@/components/events/event-editor-dialog";
import {
  EventsCalendar,
  startOfMonth,
} from "@/components/events/events-calendar";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { formatLocaleDateTime as formatDate } from "@repo/formatting";
import { useChapterStore } from "@/lib/stores/chapter-store";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { getErrorMessage } from "@/lib/utils";

type EventRow = Record<string, unknown>;

// A day click carries no time of day, so the create form opens with a
// reasonable default slot (6-7pm) rather than midnight-to-midnight.
const CALENDAR_DEFAULT_START_HOUR = 18;

export function EventsPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<"upcoming" | "past" | "all">(
    "upcoming",
  );
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
  // `useGatedDialog` covers all three of them at once — the New Event button,
  // the empty-state CTA, and the detail sheet's Edit — and closes the dialog if
  // the subscription lapses while it is open.
  const eventWriteGate = useSubscriptionGate();
  const editorDialog = useGatedDialog(eventWriteGate);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [activeEvent, setActiveEvent] = useState<EventRow | null>(null);
  // Set only by a calendar day click, so the "New Event" button and the
  // empty-state CTA keep opening a blank form exactly as they do today.
  const [calendarCreateDay, setCalendarCreateDay] = useState<Date | null>(null);
  // Lifted here (not local to EventsCalendar) because the Calendar tab's
  // content unmounts on tab switch — see EventsCalendar's own comment.
  const [calendarMonthAnchor, setCalendarMonthAnchor] = useState<Date>(() =>
    startOfMonth(new Date()),
  );
  const eventsQuery = useEvents();
  const autoAbsent = useAutoAbsent();
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
      const startRaw =
        typeof event.start_time === "string" ? event.start_time : null;
      if (!startRaw) return timeFilter === "upcoming";
      const startMs = new Date(startRaw).getTime();
      if (Number.isNaN(startMs)) return timeFilter === "upcoming";
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

  if (isOffline && anyReadUncached(eventsQuery)) {
    return (
      <OfflineState
        title="Events workspace unavailable offline"
        description="Reconnect to load event schedules and attendance updates."
        onRetry={() => {
          void eventsQuery.refetch();
        }}
      />
    );
  }

  if (eventsQuery.isLoading) {
    return <LoadingState message={stateMicrocopy.events.loading} />;
  }

  if (eventsQuery.isError) {
    return (
      <ErrorState
        title="Couldn't load chapter events"
        description="The events workflow needs a healthy API response. Verify your chapter access and retry."
        onRetry={() => void eventsQuery.refetch()}
      />
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Events</CardTitle>
            <CardDescription>
              Plan chapter events and monitor attendance operations.
            </CardDescription>
          </div>
          <Button
            className="gap-2"
            {...eventWriteGate.controlProps()}
            onClick={() => {
              setEditorMode("create");
              setActiveEvent(null);
              setCalendarCreateDay(null);
              editorDialog.setOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Event
          </Button>
        </CardHeader>
        <CardContent>
          {/*
            Above the filters so it sits with the New Event button it explains.
            Search and the time/status filters below are reads and stay live —
            a lapsed chapter keeps full visibility of its own calendar.
          */}
          <SubscriptionNotice
            gate={eventWriteGate}
            feature="creating and editing events"
          />
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md">
              <SearchGlyph className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events by name or location"
                aria-label="Search events by name or location"
                className="h-11 pl-9"
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <select
                value={timeFilter}
                onChange={(event) =>
                  setTimeFilter(
                    event.target.value as "upcoming" | "past" | "all",
                  )
                }
                className={dashboardFilterSelectClassName}
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
                className={dashboardFilterSelectClassName}
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
                className={dashboardFilterSelectClassName}
                aria-label="Filter events by cadence"
              >
                <option value="all">Cadence: All</option>
                <option value="recurring">Cadence: Recurring</option>
                <option value="one-time">Cadence: One-time</option>
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {selectedEventIds.length > 0 ? (
        <Card className="border-accent-border bg-accent-subtle">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-semibold">
              {selectedEventIds.length} event
              {selectedEventIds.length > 1 ? "s" : ""} selected
            </p>
            {/*
              Notify assignees and Archive selected removed rather than wired
              (#336): events have no assignee concept and no archive state —
              only delete/cancel — so there is no real mutation to call
              without inventing one.
            */}
            <Button
              size="sm"
              variant="secondary"
              disabled={autoAbsent.isPending}
              onClick={() => void markSelectedAttendanceComplete()}
            >
              Mark attendance complete
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Tabs defaultValue="list">
        <TabsList>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="calendar">Calendar</TabsTrigger>
        </TabsList>

        <TabsContent value="list">
          {filteredEvents.length === 0 ? (
            <EmptyState
              title={stateMicrocopy.events.emptyTitle}
              description={stateMicrocopy.events.emptyDescription}
              actionLabel="Create first event"
              actionProps={eventWriteGate.controlProps()}
              onAction={() => {
                setEditorMode("create");
                setActiveEvent(null);
                setCalendarCreateDay(null);
                editorDialog.setOpen(true);
              }}
            />
          ) : (
            <Card>
              <CardHeader>
                <CardTitle className="text-lg">
                  Upcoming & Recent Events
                </CardTitle>
                <CardDescription>
                  Attendance windows and point values are configured per event.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className={dashboardCheckboxCellClassName}>
                        <label className={dashboardCheckboxHitAreaClassName}>
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
                      </TableHead>
                      <TableHead>Event</TableHead>
                      <TableHead>Schedule</TableHead>
                      <TableHead>Location</TableHead>
                      <TableHead>Points</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEvents.map((event) => {
                      const eventId = String(
                        event.id ?? event.name ?? "unknown-event",
                      );
                      const eventName = String(event.name ?? "Untitled event");
                      const pointValue =
                        typeof event.point_value === "number"
                          ? event.point_value
                          : 0;
                      const isMandatory =
                        typeof event.is_mandatory === "boolean"
                          ? event.is_mandatory
                          : false;
                      const recurrenceRule =
                        typeof event.recurrence_rule === "string"
                          ? event.recurrence_rule
                          : "";
                      // One derived value: the row fill and the checkbox must never
                      // disagree about whether the row is selected.
                      const isSelected = selectedEventIds.includes(eventId);
                      const requiredRoleIds = Array.isArray(
                        event.required_role_ids,
                      )
                        ? event.required_role_ids.filter(
                            (id): id is string => typeof id === "string",
                          )
                        : [];
                      return (
                        <TableRow
                          key={eventId}
                          data-state={isSelected ? "selected" : undefined}
                        >
                          <TableCell className={dashboardCheckboxCellClassName}>
                            <label
                              className={dashboardCheckboxHitAreaClassName}
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
                          </TableCell>
                          <TableCell className="font-semibold">
                            {eventName}
                          </TableCell>
                          <TableCell className="text-sm text-muted-foreground">
                            {formatDate(event.start_time)}
                          </TableCell>
                          <TableCell>
                            {String(event.location ?? "TBD")}
                          </TableCell>
                          <TableCell>{pointValue}</TableCell>
                          <TableCell>
                            <div className="flex flex-wrap gap-2">
                              {isMandatory ? (
                                <Badge>Mandatory</Badge>
                              ) : (
                                <Badge variant="secondary">Optional</Badge>
                              )}
                              {recurrenceRule ? (
                                <Badge variant="outline" className="gap-1">
                                  <EventsGlyph className="h-3.5 w-3.5" />
                                  {recurrenceRule}
                                </Badge>
                              ) : null}
                              {requiredRoleIds.length > 0 ? (
                                <Badge variant="outline" className="gap-1">
                                  <RolesGlyph className="h-3.5 w-3.5" />
                                  Targeted
                                </Badge>
                              ) : null}
                            </div>
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => {
                                setActiveEvent(event);
                                setDetailSheetOpen(true);
                              }}
                            >
                              View details
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="calendar">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Chapter Calendar</CardTitle>
              <CardDescription>
                Click a date to schedule an event there, or select an event to
                view its details.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <EventsCalendar
                events={calendarEvents}
                monthAnchor={calendarMonthAnchor}
                onMonthAnchorChange={setCalendarMonthAnchor}
                createDisabled={!eventWriteGate.allowed}
                createDescribedBy={
                  eventWriteGate.allowed ? undefined : eventWriteGate.noticeId
                }
                onSelectEvent={(event) => {
                  setActiveEvent(event);
                  setDetailSheetOpen(true);
                }}
                onCreateOnDay={(day) => {
                  setEditorMode("create");
                  setActiveEvent(null);
                  setCalendarCreateDay(day);
                  editorDialog.setOpen(true);
                }}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

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
    </div>
  );
}
