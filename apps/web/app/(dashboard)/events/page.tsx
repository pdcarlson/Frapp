"use client";

import { CalendarDays, Plus } from "lucide-react";
import { useEvents } from "@repo/hooks";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyState, LoadingState } from "@/components/shared/async-states";

type EventRow = Record<string, unknown>;
const fallbackEvents: EventRow[] = [
  {
    id: "preview-event-1",
    name: "Chapter Meeting",
    start_time: new Date().toISOString(),
    location: "Chapter House",
    point_value: 10,
    is_mandatory: true,
    recurrence_rule: "WEEKLY",
  },
  {
    id: "preview-event-2",
    name: "Philanthropy Showcase",
    start_time: new Date(Date.now() + 1000 * 60 * 60 * 24 * 2).toISOString(),
    location: "Student Center",
    point_value: 15,
    is_mandatory: false,
    recurrence_rule: null,
  },
];

function formatDate(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

export default function EventsPage() {
  const eventsQuery = useEvents();
  const usingPreviewData = eventsQuery.isError;
  const events = usingPreviewData
    ? fallbackEvents
    : Array.isArray(eventsQuery.data)
      ? (eventsQuery.data as EventRow[])
      : [];

  if (eventsQuery.isLoading) {
    return <LoadingState message="Loading chapter events..." />;
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Events</CardTitle>
            <CardDescription>Plan chapter events and monitor attendance operations.</CardDescription>
          </div>
          <Button className="gap-2">
            <Plus className="h-4 w-4" />
            New Event
          </Button>
        </CardHeader>
      </Card>

      {usingPreviewData ? (
        <Card className="border-amber-200 bg-amber-50/70 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="flex items-center justify-between gap-4 pt-6">
            <div>
              <p className="text-sm font-medium text-amber-900 dark:text-amber-100">
                Showing preview event data
              </p>
              <p className="text-xs text-amber-800 dark:text-amber-200">
                Sign in to load live event scheduling and attendance records.
              </p>
            </div>
            <Button size="sm" variant="outline" onClick={() => eventsQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        </Card>
      ) : null}

      {events.length === 0 ? (
        <EmptyState
          title="No events yet"
          description="Create your first chapter event to unlock attendance and point automation."
          actionLabel="Create first event"
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
                  <TableHead>Event</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Location</TableHead>
                  <TableHead>Points</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {events.map((event) => {
                  const eventName = String(event.name ?? "Untitled event");
                  const pointValue =
                    typeof event.point_value === "number" ? event.point_value : 0;
                  const isMandatory =
                    typeof event.is_mandatory === "boolean" ? event.is_mandatory : false;
                  const recurrenceRule =
                    typeof event.recurrence_rule === "string" ? event.recurrence_rule : "";
                  return (
                    <TableRow key={String(event.id ?? eventName)}>
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
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
