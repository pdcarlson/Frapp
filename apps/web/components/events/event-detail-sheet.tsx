"use client";

import { useEffect, useMemo } from "react";
import {
  AlertTriangle,
  CalendarPlus,
  Loader2,
  Pencil,
  Trash2,
} from "lucide-react";
import {
  PointsGlyph,
  RolesGlyph,
  ScheduleGlyph,
  StudyZonesGlyph,
} from "@/components/events/chapter-ops-glyphs";
import {
  useDeleteEvent,
  useDownloadEventIcs,
  useEvent,
  useRoles,
} from "@repo/hooks";
import { useToast } from "@/lib/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { AttendancePanel } from "@/components/events/attendance-panel";
import { normalizeRoleOptions } from "@/lib/roles";
import { formatDayTimeRange } from "@repo/formatting";
import { pointsLabel, recurrenceLabel } from "@/components/events/event-labels";
import { cn, downloadBlob, getErrorMessage } from "@/lib/utils";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";

type EventRecord = Record<string, unknown>;

/**
 * A header icon action: the image viewer's control size, 36 under a mouse and
 * the 44 touch floor under a finger (components.md §2).
 */
const HEADER_ACTION = "size-9 pointer-coarse:size-11";

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
  const downloadIcsMutation = useDownloadEventIcs();
  // `events-page.tsx` renders one `<EventDetailSheet>` and swaps `event`/`open`
  // props rather than remounting per event, so this mutation instance (and
  // its isPending/error state) would otherwise survive a switch to a
  // different event — showing event B's button as pending/erroring for a
  // request that was actually made against event A.
  const { reset: resetDownloadIcs } = downloadIcsMutation;
  useEffect(() => {
    resetDownloadIcs();
  }, [eventId, resetDownloadIcs]);
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
  // `null` for a one-time event, which then shows no cadence badge at all.
  const cadence = recurrenceLabel(resolvedEvent?.recurrence_rule);
  const schedule = formatDayTimeRange(
    resolvedEvent?.start_time,
    resolvedEvent?.end_time,
  );
  const location =
    typeof resolvedEvent?.location === "string" && resolvedEvent.location.trim()
      ? resolvedEvent.location.trim()
      : null;
  const points = pointsLabel(resolvedEvent?.point_value);
  const description =
    typeof resolvedEvent?.description === "string"
      ? resolvedEvent.description
      : "";
  const notes =
    typeof resolvedEvent?.notes === "string" ? resolvedEvent.notes : "";
  // Three distinct states, not two. A non-empty polygon with fewer than 3 valid
  // points is not "no zone": `isValidZone` fails closed on the server, so
  // check-in is rejected outright. Rendering that as "check in from anywhere"
  // would tell an officer the opposite of what members experience.
  const checkInZoneEntries = Array.isArray(resolvedEvent?.check_in_zone)
    ? resolvedEvent.check_in_zone
    : [];
  const checkInZonePoints = checkInZoneEntries.filter((point) => {
    if (!point || typeof point !== "object") return false;
    const { lat, lng } = point as { lat?: unknown; lng?: unknown };
    return (
      typeof lat === "number" &&
      Number.isFinite(lat) &&
      typeof lng === "number" &&
      Number.isFinite(lng)
    );
  }).length;
  // Mirrors `isValidZone` on the server, which requires **every** entry to be a
  // finite pair — not merely three of them. A 5-entry zone with 2 bad points
  // fails there and rejects every check-in, so reporting the 3 good ones as a
  // working zone would recreate the exact misdirection this block exists to
  // prevent.
  const hasCheckInZone =
    checkInZoneEntries.length >= 3 &&
    checkInZonePoints === checkInZoneEntries.length;
  const checkInZoneIsMalformed =
    checkInZoneEntries.length > 0 && !hasCheckInZone;
  const checkInZoneName =
    typeof resolvedEvent?.check_in_zone_name === "string"
      ? resolvedEvent.check_in_zone_name.trim()
      : "";

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

  // Preview mode has no live event to fetch an .ics for — `canMutate` already
  // guards the button, but the guard is repeated here so this can never fire
  // from a stray keyboard/programmatic click.
  async function handleAddToCalendar() {
    if (!eventId || usingPreviewData) return;

    try {
      const icsBlob = await downloadIcsMutation.mutateAsync(eventId);
      const slug =
        eventName
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "") || "frapp-event";
      downloadBlob(icsBlob, `${slug}.ics`);
    } catch (error) {
      toast({
        title: "Could not export calendar file",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
    }
  }

  const editControl = gate.controlProps(!resolvedEvent);
  const deleteControl = gate.controlProps(
    !canMutate || deleteEventMutation.isPending,
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        No description: the one this had explained the sheet to someone already
        reading it. `aria-describedby={undefined}` says so to Radix, which
        otherwise warns about a missing Description.
      */}
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
        aria-describedby={undefined}
      >
        {/*
          The sheet's actions are icons in its header, beside the close, as
          the image viewer's are (components.md § Chrome weight). They were
          three full-width worded buttons opening the body, which made the
          first thing in an event's details a toolbar. The words live on as
          each control's accessible name and tooltip. `right-12` clears the
          close button `SheetContent` draws at `right-4`, and the title's
          right padding clears both.
        */}
        <SheetHeader className="pr-36">
          <SheetTitle>{eventName}</SheetTitle>
        </SheetHeader>
        <div className="absolute right-12 top-2.5 flex items-center">
          <Button
            variant="quiet"
            size="icon"
            className={HEADER_ACTION}
            aria-label="Add to calendar"
            title="Add to calendar"
            disabled={!canMutate || downloadIcsMutation.isPending}
            onClick={handleAddToCalendar}
          >
            {downloadIcsMutation.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <CalendarPlus aria-hidden="true" />
            )}
          </Button>
          <Button
            variant="quiet"
            size="icon"
            className={HEADER_ACTION}
            aria-label="Edit event"
            {...editControl}
            title={editControl.title ?? "Edit event"}
            onClick={() => {
              if (!resolvedEvent) return;
              onRequestEdit(resolvedEvent);
            }}
          >
            <Pencil aria-hidden="true" />
          </Button>
          <Button
            variant="quiet"
            size="icon"
            className={cn(HEADER_ACTION, "hover:text-destructive-text")}
            aria-label="Delete event"
            {...deleteControl}
            title={deleteControl.title ?? "Delete event"}
            onClick={handleDelete}
          >
            {deleteEventMutation.isPending ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Trash2 aria-hidden="true" />
            )}
          </Button>
        </div>

        {usingPreviewData ? (
          <div className="mt-5 flex items-start gap-3 rounded-md border border-warning/45 bg-warning-tint p-3 text-caption text-warning">
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

        <SubscriptionNotice gate={gate} feature="editing events" />

        <div className="mt-5 grid gap-3">
          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-caption text-muted-foreground">
              Attendance policy
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={isMandatory ? "default" : "secondary"}>
                {isMandatory ? "Mandatory" : "Optional"}
              </Badge>
              {cadence ? <Badge variant="outline">{cadence}</Badge> : null}
            </div>
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-caption text-muted-foreground">
                <RolesGlyph className="h-3.5 w-3.5" />
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
            <div className="mt-3">
              <p className="mb-1 flex items-center gap-1 text-caption text-muted-foreground">
                <StudyZonesGlyph className="h-3.5 w-3.5" />
                Check-in zone
              </p>
              {hasCheckInZone ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="default">
                    {checkInZoneName ? checkInZoneName : "Zone set"}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {checkInZonePoints} points. Members must be inside to check
                    in
                  </span>
                </div>
              ) : checkInZoneIsMalformed ? (
                <div className="flex items-start gap-2 rounded-md border border-warning/45 bg-warning-tint p-3 text-caption text-warning">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                  <div>
                    This event&apos;s zone is incomplete, so every check-in is
                    rejected. Edit the event to finish or clear it.
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  No zone, so members can check in from anywhere
                </p>
              )}
            </div>
          </div>

          <div className="rounded-lg border border-border p-3">
            <p className="mb-2 text-caption text-muted-foreground">Schedule</p>
            {/*
              One line for when, the mobile event header's shape, in place of
              "Starts:" and "Ends:" lines. A fact the event does not have drops
              out rather than reading "TBD" or "0 points".
            */}
            <div className="space-y-2 text-sm">
              <div className="flex items-start gap-2">
                <ScheduleGlyph className="mt-0.5 h-4 w-4 text-muted-foreground" />
                <p>{schedule ?? "Not set"}</p>
              </div>
              {location ? (
                <div className="flex items-start gap-2">
                  <StudyZonesGlyph className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <p>{location}</p>
                </div>
              ) : null}
              {points ? (
                <div className="flex items-start gap-2">
                  <PointsGlyph className="mt-0.5 h-4 w-4 text-muted-foreground" />
                  <p>{points}</p>
                </div>
              ) : null}
            </div>
          </div>

          {description ? (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 text-caption text-muted-foreground">
                Description
              </p>
              {/* Same fix as the minutes block below: the source is a
                  multi-line Textarea, so preserve line breaks instead of
                  collapsing them. */}
              <p className="whitespace-pre-wrap break-words text-sm">
                {description}
              </p>
            </div>
          ) : null}

          {notes ? (
            <div className="rounded-lg border border-border p-3">
              <p className="mb-1 text-caption text-muted-foreground">
                Meeting minutes
              </p>
              {/* Same plain-text convention as chat's TextRenderer (#369 owns
                  a real markdown renderer if that lands later) — preserve the
                  line breaks admins typed instead of collapsing them. */}
              <p className="whitespace-pre-wrap break-words text-sm">{notes}</p>
            </div>
          ) : null}

          {eventId && !usingPreviewData ? (
            <AttendancePanel
              eventId={eventId}
              eventStart={resolvedEvent?.start_time}
            />
          ) : null}
        </div>
        {confirmDialog}
      </SheetContent>
    </Sheet>
  );
}
