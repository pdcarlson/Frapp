"use client";

import { useMemo, useState } from "react";
import { CalendarDays, Plus, Search } from "lucide-react";
import { useEvents } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  EmptyState,
  ErrorState,
  LoadingState,
  OfflineState,
} from "@/components/shared/async-states";
import {
  dashboardFilterSelectClassName,
  dashboardTableCheckboxClassName,
} from "@/components/shared/table-controls";
import { useToast } from "@/hooks/use-toast";
import { EventDetailSheet } from "@/components/events/event-detail-sheet";
import { EventEditorDialog } from "@/components/events/event-editor-dialog";
import { stateMicrocopy } from "@/lib/state-microcopy";
import { useNetwork } from "@/lib/providers/network-provider";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { useChapterStore } from "@/lib/stores/chapter-store";

type EventRow = Record<string, unknown>;

function formatDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export default function EventsPage() {
  const { isOffline } = useNetwork();
  const { toast } = useToast();
  const activeChapterId = useChapterStore((s) => s.activeChapterId);
  const [query, setQuery] = useState("");
  const [timeFilter, setTimeFilter] = useState<"upcoming" | "past" | "all">(
    "upcoming",
  );
  const [attendanceFilter, setAttendanceFilter] = useState<"all" | "mandatory" | "optional">("all");
  const [recurrenceFilter, setRecurrenceFilter] = useState<"all" | "recurring" | "one-time">("all");
  const [selectedEventIds, setSelectedEventIds] = useState<string[]>([]);
  const [detailSheetOpen, setDetailSheetOpen] = useState(false);
  const [editorDialogOpen, setEditorDialogOpen] = useState(false);
  const [editorMode, setEditorMode] = useState<"create" | "edit">("create");
  const [activeEvent, setActiveEvent] = useState<EventRow | null>(null);
  const eventsQuery = useEvents();

  // Live updates: any admin creating or editing an event in another tab
  // pushes through immediately. Scoped to the active chapter so we never
  // invalidate another chapter's cache.
  useRealtimeTable({
    table: "events",
    filter: activeChapterId ? `chapter_id=eq.${activeChapterId}` : undefined,
    invalidate: [["events", activeChapterId]],
    enabled: Boolean(activeChapterId),
  });

  const events = useMemo(() => {
    if (Array.isArray(eventsQuery.data)) {
      return eventsQuery.data as EventRow[];
    }
    return [];
  }, [eventsQuery.data]);
  const filteredEvents = useMemo(() => {
    const queryLower = query.trim().toLowerCase();
    const now = Date.now();
    return events.filter((event) => {
      const name = String(event.name ?? "").toLowerCase();
      const location = String(event.location ?? "").toLowerCase();
      const recurrenceRule =
        typeof event.recurrence_rule === "string" ? event.recurrence_rule : "";
      const isRecurring = recurrenceRule.length > 0;
      const isMandatory =
        typeof event.is_mandatory === "boolean" ? event.is_mandatory : false;

      if (queryLower && !name.includes(queryLower) && !location.includes(queryLower)) {
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

      if (timeFilter !== "all") {
        const startRaw =
          typeof event.start_time === "string" ? event.start_time : null;
        if (!startRaw) return timeFilter === "upcoming";
        const startMs = new Date(startRaw).getTime();
        if (Number.isNaN(startMs)) return timeFilter === "upcoming";
        if (timeFilter === "upcoming" && startMs < now) return false;
        if (timeFilter === "past" && startMs >= now) return false;
      }

      return true;
    });
  }, [events, query, attendanceFilter, recurrenceFilter, timeFilter]);
  const visibleEventIds = filteredEvents.map((event) => String(event.id ?? event.name ?? ""));
  const allVisibleSelected =
    visibleEventIds.length > 0 &&
    visibleEventIds.every((eventId) => selectedEventIds.includes(eventId));

  function toggleAllVisibleEvents(checked: boolean) {
    if (checked) {
      setSelectedEventIds((previous) => [...new Set([...previous, ...visibleEventIds])]);
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

  function handleBulkAction(actionLabel: string) {
    toast({
      title: "Bulk event action queued",
      description: `${actionLabel} for ${selectedEventIds.length} selected event${selectedEventIds.length > 1 ? "s" : ""} is not available yet.`,
    });
  }

  if (isOffline) {
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
            <CardDescription>Plan chapter events and monitor attendance operations.</CardDescription>
          </div>
          <Button
            className="gap-2"
            onClick={() => {
              setEditorMode("create");
              setActiveEvent(null);
              setEditorDialogOpen(true);
            }}
          >
            <Plus className="h-4 w-4" />
            New Event
          </Button>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="relative max-w-md">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search events by name or location"
                className="pl-9"
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
        <Card className="border-primary/30 bg-primary-50/70 dark:bg-primary/10">
          <CardContent className="flex flex-col gap-3 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm font-medium">
              {selectedEventIds.length} event{selectedEventIds.length > 1 ? "s" : ""} selected
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkAction("Mark attendance complete")}
              >
                Mark attendance complete
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkAction("Notify assignees")}
              >
                Notify assignees
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => handleBulkAction("Archive selected")}
              >
                Archive selected
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {filteredEvents.length === 0 ? (
        <EmptyState
          title={stateMicrocopy.events.emptyTitle}
          description={stateMicrocopy.events.emptyDescription}
          actionLabel="Create first event"
          onAction={() => {
            setEditorMode("create");
            setActiveEvent(null);
            setEditorDialogOpen(true);
          }}
        />
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Upcoming & Recent Events</CardTitle>
            <CardDescription>
              Attendance windows and point values are configured per event.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">
                    <input
                      type="checkbox"
                      aria-label="Select all visible events"
                      className={dashboardTableCheckboxClassName}
                      checked={allVisibleSelected}
                      onChange={(event) => toggleAllVisibleEvents(event.target.checked)}
                    />
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
                  const eventId = String(event.id ?? event.name ?? "unknown-event");
                  const eventName = String(event.name ?? "Untitled event");
                  const pointValue =
                    typeof event.point_value === "number" ? event.point_value : 0;
                  const isMandatory =
                    typeof event.is_mandatory === "boolean" ? event.is_mandatory : false;
                  const recurrenceRule =
                    typeof event.recurrence_rule === "string" ? event.recurrence_rule : "";
                  return (
                    <TableRow key={eventId}>
                      <TableCell className="w-10">
                        <input
                          type="checkbox"
                          aria-label={`Select ${eventName}`}
                          className={dashboardTableCheckboxClassName}
                          checked={selectedEventIds.includes(eventId)}
                          onChange={(eventValue) => toggleEventSelection(eventId, eventValue.target.checked)}
                        />
                      </TableCell>
                      <TableCell className="font-medium">{eventName}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(event.start_time)}
                      </TableCell>
                      <TableCell>{String(event.location ?? "TBD")}</TableCell>
                      <TableCell>{pointValue}</TableCell>
                      <TableCell>
                        <div className="flex flex-wrap gap-2">
                          {isMandatory ? <Badge>Mandatory</Badge> : <Badge variant="secondary">Optional</Badge>}
                          {recurrenceRule ? (
                            <Badge variant="outline" className="gap-1">
                              <CalendarDays className="h-3 w-3" />
                              {recurrenceRule}
                            </Badge>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
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

      <EventDetailSheet
        open={detailSheetOpen}
        onOpenChange={setDetailSheetOpen}
        event={activeEvent}
        usingPreviewData={false}
        onRequestEdit={(event) => {
          setActiveEvent(event);
          setDetailSheetOpen(false);
          setEditorMode("edit");
          setEditorDialogOpen(true);
        }}
        onEventDeleted={async () => {
          await eventsQuery.refetch();
        }}
      />

      <EventEditorDialog
        open={editorDialogOpen}
        onOpenChange={setEditorDialogOpen}
        mode={editorMode}
        event={activeEvent}
        usingPreviewData={false}
        onSaved={async () => {
          await eventsQuery.refetch();
        }}
      />
    </div>
  );
}
