"use client";

import { useMemo } from "react";
import { AlertTriangle, BellRing, CalendarDays, Clock3, Loader2, MapPin, Trash2, UsersRound } from "lucide-react";
import { useDeleteEvent, useEvent } from "@repo/hooks";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";

type EventRecord = Record<string, unknown>;

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Something went wrong. Please retry.";
}

function formatDateTime(value: unknown): string {
  if (typeof value !== "string") return "—";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "—";
  return parsed.toLocaleString();
}

type EventDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventRecord | null;
  usingPreviewData: boolean;
  onRequestEdit: (event: EventRecord) => void;
  onEventDeleted: () => Promise<void> | void;
};

export function EventDetailSheet({
  open,
  onOpenChange,
  event,
  usingPreviewData,
  onRequestEdit,
  onEventDeleted,
}: EventDetailSheetProps) {
  const eventId = typeof event?.id === "string" ? event.id : "";
  const eventQuery = useEvent(!usingPreviewData ? eventId : "");
  const deleteEventMutation = useDeleteEvent();
  const { toast } = useToast();

  const resolvedEvent = useMemo(() => {
    if (!event) return null;
    if (usingPreviewData) return event;
    if (eventQuery.data && typeof eventQuery.data === "object") {
      return eventQuery.data as EventRecord;
    }
    return event;
  }, [event, eventQuery.data, usingPreviewData]);

  const canMutate = !usingPreviewData && !eventQuery.isError;
  const eventName =
    typeof resolvedEvent?.name === "string" && resolvedEvent.name.length > 0
      ? resolvedEvent.name
      : "Untitled event";
  const isMandatory =
    typeof resolvedEvent?.is_mandatory === "boolean" ? resolvedEvent.is_mandatory : false;
  const recurrenceRule =
    typeof resolvedEvent?.recurrence_rule === "string" && resolvedEvent.recurrence_rule.length > 0
      ? resolvedEvent.recurrence_rule
      : "One-time";
  const description =
    typeof resolvedEvent?.description === "string" ? resolvedEvent.description : "";
  const notes = typeof resolvedEvent?.notes === "string" ? resolvedEvent.notes : "";
  const attendanceActionsAvailable = false;
  const attendanceActionDisabledReason = !canMutate
    ? "Sign in with chapter permissions to run attendance actions."
    : "Attendance actions are coming soon.";

  async function handleDelete() {
    if (!eventId) return;
    const confirmed = window.confirm(
      `Delete ${eventName}? This action cannot be undone and attendance records may be affected.`,
    );
    if (!confirmed) return;

    try {
      await deleteEventMutation.mutateAsync(eventId);
    } catch (error) {
      toast({
        title: "Could not delete event",
        description: getErrorMessage(error),
        variant: "destructive",
      });
      return;
    }

    toast({
      title: "Event deleted",
      description: `${eventName} was removed from the calendar.`,
    });
    onOpenChange(false);

    try {
      await onEventDeleted();
    } catch {
      toast({
        title: "Event deleted, but refresh failed",
        description: "Reload this page to sync the latest event list.",
        variant: "destructive",
      });
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{eventName}</SheetTitle>
          <SheetDescription>
            Review scheduling details, recurrence settings, and attendance policy.
          </SheetDescription>
        </SheetHeader>

        {usingPreviewData ? (
          <div className="mt-5 flex items-start gap-3 rounded-md border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>Showing preview event details. Sign in to edit and delete live events.</div>
          </div>
        ) : null}

        {eventQuery.isLoading && !usingPreviewData ? (
          <div className="mt-6 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading event details...
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={!resolvedEvent}
            onClick={() => {
              if (!resolvedEvent) return;
              onRequestEdit(resolvedEvent);
            }}
          >
            Edit event
          </Button>
          <Button
            variant="destructive"
            disabled={!canMutate || deleteEventMutation.isPending}
            onClick={handleDelete}
          >
            {deleteEventMutation.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Trash2 className="h-4 w-4" />
            )}
            Delete event
          </Button>
        </div>

        <div className="mt-5 grid gap-3">
          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">Attendance</p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isMandatory ? "default" : "secondary"}>
                {isMandatory ? "Mandatory" : "Optional"}
              </Badge>
              <Badge variant="outline">{recurrenceRule}</Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={!resolvedEvent || !canMutate || !attendanceActionsAvailable}
                title={attendanceActionDisabledReason}
                aria-label={`Open attendance queue. ${attendanceActionDisabledReason}`}
              >
                <UsersRound className="h-4 w-4" />
                Open attendance queue
              </Button>
              <Button
                size="sm"
                variant="secondary"
                disabled={!resolvedEvent || !canMutate || !attendanceActionsAvailable}
                title={attendanceActionDisabledReason}
                aria-label={`Send check-in reminder. ${attendanceActionDisabledReason}`}
              >
                <BellRing className="h-4 w-4" />
                Send check-in reminder
              </Button>
            </div>
          </div>

          <div className="rounded-md border border-border p-3">
            <p className="mb-2 text-xs text-muted-foreground">Schedule</p>
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <Clock3 className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <div>
                  <p>Starts: {formatDateTime(resolvedEvent?.start_time)}</p>
                  <p>Ends: {formatDateTime(resolvedEvent?.end_time)}</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <p>{typeof resolvedEvent?.location === "string" ? resolvedEvent.location : "TBD"}</p>
              </div>
              <div className="flex items-start gap-2">
                <CalendarDays className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <p>
                  {typeof resolvedEvent?.point_value === "number"
                    ? `${resolvedEvent.point_value} point(s)`
                    : "0 points"}
                </p>
              </div>
            </div>
          </div>

          {description ? (
            <div className="rounded-md border border-border p-3">
              <p className="mb-1 text-xs text-muted-foreground">Description</p>
              <p className="text-sm">{description}</p>
            </div>
          ) : null}

          {notes ? (
            <div className="rounded-md border border-border p-3">
              <p className="mb-1 text-xs text-muted-foreground">Internal notes</p>
              <p className="text-sm">{notes}</p>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
