"use client";

import { useMemo } from "react";
import {
  AlertTriangle,
  CalendarDays,
  Clock3,
  Loader2,
  MapPin,
  Shield,
  Trash2,
} from "lucide-react";
import { useDeleteEvent, useEvent, useRoles } from "@repo/hooks";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AttendancePanel } from "@/components/events/attendance-panel";
import { normalizeRoleOptions } from "@/lib/roles";
import { formatLocaleDateTime as formatDateTime } from "@repo/formatting";
import { getErrorMessage } from "@/lib/utils";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";

type EventRecord = Record<string, unknown>;

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
  // `DELETE /v1/events/:id` and the `PATCH /v1/events/:id` behind "Edit event"
  // are both paid-ops. Edit is gated here rather than only inside the editor
  // dialog because this button *is* the trigger for that flow (§5 rule 1) —
  // gating only the editor's submit would let the user reopen and refill it.
  const gate = useSubscriptionGate();
  const { confirm, confirmDialog } = useConfirmDialog();
  const rolesQuery = useRoles();
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
    typeof resolvedEvent?.is_mandatory === "boolean"
      ? resolvedEvent.is_mandatory
      : false;
  const recurrenceRule =
    typeof resolvedEvent?.recurrence_rule === "string" &&
    resolvedEvent.recurrence_rule.length > 0
      ? resolvedEvent.recurrence_rule
      : "One-time";
  const description =
    typeof resolvedEvent?.description === "string"
      ? resolvedEvent.description
      : "";
  const notes =
    typeof resolvedEvent?.notes === "string" ? resolvedEvent.notes : "";
  const rawRequiredRoleIds = resolvedEvent?.required_role_ids;
  const requiredRoleIds = Array.isArray(rawRequiredRoleIds)
    ? rawRequiredRoleIds.filter((id): id is string => typeof id === "string")
    : [];
  const roleNameById = useMemo(
    () =>
      new Map(
        normalizeRoleOptions(rolesQuery.data).map((role) => [
          role.id,
          role.name,
        ]),
      ),
    [rolesQuery.data],
  );

  async function handleDelete() {
    if (!eventId) return;
    const confirmed = await confirm({
      title: `Delete ${eventName}?`,
      description:
        "This cannot be undone, and attendance records for the event may be affected.",
      confirmLabel: "Delete event",
      tone: "destructive",
    });
    if (!confirmed) return;

    try {
      await deleteEventMutation.mutateAsync(eventId);
    } catch (error) {
      toast({
        title: "Could not delete event",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
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
            Review scheduling details, recurrence settings, and attendance
            policy.
          </SheetDescription>
        </SheetHeader>

        {usingPreviewData ? (
          <div className="mt-5 flex items-start gap-3 rounded-md border border-warning/45 bg-warning/[.13] p-3 text-[12.5px] text-warning">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              Showing preview event details. Sign in to edit and delete live
              events.
            </div>
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
            variant="secondary"
            {...gate.controlProps(!resolvedEvent)}
            onClick={() => {
              if (!resolvedEvent) return;
              onRequestEdit(resolvedEvent);
            }}
          >
            Edit event
          </Button>
          <Button
            variant="destructive"
            {...gate.controlProps(!canMutate || deleteEventMutation.isPending)}
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

        <SubscriptionNotice gate={gate} feature="editing events" />

        <div className="mt-5 grid gap-3">
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-[12.5px] text-muted-foreground">
              Attendance policy
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isMandatory ? "default" : "secondary"}>
                {isMandatory ? "Mandatory" : "Optional"}
              </Badge>
              <Badge variant="outline">{recurrenceRule}</Badge>
            </div>
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-[12.5px] text-muted-foreground">
                <Shield className="h-3 w-3" />
                Required roles
              </p>
              {requiredRoleIds.length === 0 ? (
                <p className="text-sm text-muted-foreground">All members</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {requiredRoleIds.map((id) => (
                    <Badge key={id} variant="outline">
                      {roleNameById.get(id) ?? `Role ${id.slice(0, 8)}`}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-[12.5px] text-muted-foreground">Schedule</p>
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
                <p>
                  {typeof resolvedEvent?.location === "string"
                    ? resolvedEvent.location
                    : "TBD"}
                </p>
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
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 text-[12.5px] text-muted-foreground">Description</p>
              <p className="text-sm">{description}</p>
            </div>
          ) : null}

          {notes ? (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 text-[12.5px] text-muted-foreground">
                Internal notes
              </p>
              <p className="text-sm">{notes}</p>
            </div>
          ) : null}

          {eventId && !usingPreviewData ? (
            <AttendancePanel eventId={eventId} />
          ) : null}
        </div>
        {confirmDialog}
      </SheetContent>
    </Sheet>
  );
}
