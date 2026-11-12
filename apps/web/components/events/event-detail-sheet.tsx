"use client";

import { can, checkInZoneLine } from "@repo/validation";
import { useMemo } from "react";
import { AlertTriangle, Loader2, Pencil, Trash2 } from "lucide-react";
import { SectionSkeleton } from "@/components/shared/page-skeletons";
import { SkeletonText } from "@/components/shared/async-states";
import {
  PointsGlyph,
  RolesGlyph,
  ScheduleGlyph,
  StudyZonesGlyph,
} from "@/components/events/chapter-ops-glyphs";
import {
  useActiveChapterId,
  useDeleteEvent,
  useEvent,
  useMyPermissions,
  useRoles,
} from "@repo/hooks";
import { statusOf } from "@repo/api-sdk";
import { useRealtimeTable } from "@/lib/realtime/use-realtime-table";
import { useNetwork } from "@/lib/providers/network-provider";
import { useRefetchAfterOutage } from "@/lib/hooks/use-refetch-after-outage";
import { useToast } from "@/lib/hooks/use-toast";
import {
  EVENT_ATTENDANCE_LABELS,
  attendanceFieldsOf,
  attendanceFromEvent,
} from "@repo/validation";
import { Badge } from "@/components/ui/badge";
import { IconButton } from "@/components/ui/icon-button";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelHeader,
} from "@/components/shared/panel";
import { AttendancePanel } from "@/components/events/attendance-panel";
import { MyCheckIn } from "@/components/events/my-check-in";
import { Can } from "@/components/shared/can";
import { PermissionsOfflineSurface } from "@/components/shared/async-states";
import { normalizeRoleOptions } from "@/lib/roles";
import { formatDayTime, formatDayTimeRange } from "@repo/formatting";
import { pointsLabel, recurrenceLabel } from "@/components/events/event-labels";
import { cn, getErrorMessage } from "@/lib/utils";
import { FOCUS_RING_OFFSET } from "@/components/ui/focus";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import {
  EventMinutes,
  useMeetingsModuleOn,
} from "@/components/meetings/event-minutes";

type EventRecord = Record<string, unknown>;

type EventDetailSheetProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  event: EventRecord | null;
  /**
   * The upcoming meetings of the series this occurrence belongs to, soonest
   * first and this one included, listed under it (#3707), whether the sheet
   * was opened from the list or the calendar. `null` or absent for a one-time
   * event.
   */
  series?: EventRecord[] | null;
  /**
   * The series' rule, read off its head by the caller: only the head row
   * carries one, so a generated meeting's own `recurrence_rule` is `null`.
   */
  seriesRule?: unknown;
  /** Opens another meeting of {@link series} in this sheet. */
  onSelectOccurrence?: (event: EventRecord) => void;
  usingPreviewData: boolean;
  onRequestEdit: (event: EventRecord) => void;
  onEventDeleted: () => Promise<void> | void;
  /**
   * Open inside the Events page instead of over the app (`shared/panel.tsx`
   * § Docked). The Events page sets it; a caller with no page of its own
   * leaves the sheet.
   */
  docked?: boolean;
};

export function EventDetailSheet({
  open,
  onOpenChange,
  event,
  series = null,
  seriesRule,
  onSelectOccurrence,
  usingPreviewData,
  onRequestEdit,
  onEventDeleted,
  docked = false,
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
  // With meetings on, the minutes are their own document and this field is
  // the event's notes (`spec/behavior/meetings.md` § Where minutes live).
  const meetingsOn = useMeetingsModuleOn();
  const rolesQuery = useRoles();
  const { toast } = useToast();
  // Edit and Delete are `events:update` and `events:delete` on the server, so
  // a member gets neither icon rather than two that 403 (#3855). A boolean,
  // not a `<Can>`: the header has no room for an offline chip per icon. It
  // reads the permissions as `<Can>` does (`components/shared/can.tsx`):
  // loading, or failed while online, is a denial, so the icons never flash or
  // linger for a member; unanswerable for want of a connection (paused, or
  // offline with nothing cached) keeps both, disabled by the subscription
  // gate while offline, rather than hidden as if the role lacked them. The
  // preview sheet keeps both too.
  const permissionsQuery = useMyPermissions();
  const { isOffline } = useNetwork();
  const permissionsUnanswerable =
    permissionsQuery.data === undefined &&
    (permissionsQuery.fetchStatus === "paused" ||
      (isOffline &&
        (permissionsQuery.isError ||
          permissionsQuery.fetchStatus === "fetching")));
  // As `<Can>` does: a read that failed during an outage is re-run when it
  // ends, so the icons don't wait on some other gate to recover them.
  useRefetchAfterOutage({
    isOffline,
    enabled: true,
    isError: permissionsQuery.isError,
    loaded: permissionsQuery.data !== undefined,
    refetch: permissionsQuery.refetch,
  });
  const permissions = permissionsQuery.data?.permissions;
  const canEditEvent =
    usingPreviewData ||
    permissionsUnanswerable ||
    can("events:update", permissions);
  const canDeleteEvent =
    usingPreviewData ||
    permissionsUnanswerable ||
    can("events:delete", permissions);

  // Live attendance for every viewer: an officer's mark, or a check-in from
  // another device, refreshes both the roster and the member's own row (both
  // live under `["attendance", eventId]`). Held here, not in the roster, so a
  // member gets it too; one subscription per topic, because a second channel
  // on `attendance:<eventId>` releases the first.
  const chapterId = useActiveChapterId();
  useRealtimeTable({
    table: "event_attendance",
    scopeId: eventId,
    invalidate: useMemo(
      () => [
        ["attendance", eventId],
        // Must match useEvent(id) → ["events", chapterId, id]; ["events", id] never matches.
        ["events", chapterId, eventId],
      ],
      [chapterId, eventId],
    ),
    // Only while the sheet is open: the page keeps it mounted after a close,
    // and a closed sheet has nothing to refresh.
    enabled: open && Boolean(eventId) && !usingPreviewData,
  });
  // The event is gone (404), or never loaded. Not any failed read: a failed
  // background refetch keeps its data, and one throttled refetch must not
  // take Check in away from an event that is fine.
  const eventUnavailable =
    eventQuery.isError &&
    (statusOf(eventQuery.error) === 404 || eventQuery.data === undefined);

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
  // Who's coming, by role (`spec/behavior/events.md` § Attendance by role).
  const attendance = attendanceFromEvent(
    attendanceFieldsOf(resolvedEvent ?? {}),
  );
  const isMandatory = attendance.everyone === "required";
  // `null` for a one-time event, which then shows no cadence badge at all.
  // The head's rule when the caller knows the series: a generated meeting
  // carries none of its own, and would otherwise read as one-time.
  const cadence = recurrenceLabel(
    seriesRule ?? resolvedEvent?.recurrence_rule,
    resolvedEvent?.start_time,
  );
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

  const roleNameById = useMemo(
    () =>
      new Map(
        normalizeRoleOptions(rolesQuery.data, "keep").map((role) => [
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

  const editControl = gate.controlProps(!resolvedEvent);
  const deleteControl = gate.controlProps(
    !canMutate || deleteEventMutation.isPending,
  );

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      docked={docked}
      backLabel="Back to events"
    >
      {/*
        No description: the one this had explained the sheet to someone already
        reading it. `aria-describedby={undefined}` says so to Radix, which
        otherwise warns about a missing Description.
      */}
      <PanelContent aria-describedby={undefined}>
        {/*
          The panel's actions are icons in its title row, beside the close
          (components.md § Chrome weight). They were full-width worded
          buttons opening the body, which made the first thing in an event's
          details a toolbar. The words live on as each control's accessible
          name and tooltip (`IconButton`, components.md § Icon-only actions).
        */}
        <PanelHeader
          actions={
            <>
              {canEditEvent ? (
                <IconButton
                  label="Edit event"
                  {...editControl}
                  onClick={() => {
                    if (!resolvedEvent) return;
                    onRequestEdit(resolvedEvent);
                  }}
                >
                  <Pencil aria-hidden="true" />
                </IconButton>
              ) : null}
              {canDeleteEvent ? (
                <IconButton
                  label="Delete event"
                  className="hover:text-destructive-text"
                  {...deleteControl}
                  onClick={handleDelete}
                >
                  {deleteEventMutation.isPending ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash2 aria-hidden="true" />
                  )}
                </IconButton>
              ) : null}
            </>
          }
        >
          {eventName}
        </PanelHeader>
        {/* `gap-0`: the blocks below carry their own top margins. */}
        <PanelBody className="gap-0">
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
            // A skeleton, not a spinner and caption (`components.md` §10).
            <SectionSkeleton label="Loading event details" className="mt-6">
              <SkeletonText lines={4} />
            </SectionSkeleton>
          ) : null}

          {canEditEvent || canDeleteEvent ? (
            <SubscriptionNotice gate={gate} feature="editing events" />
          ) : null}

          <div className="mt-5 grid gap-3">
            {/*
              Every viewer's own check-in, first because it is the one thing
              on the sheet a member can act on. Officers check in too, so they
              get it as well as the roster below.
            */}
            {eventId && !usingPreviewData ? (
              <MyCheckIn
                eventId={eventId}
                start={resolvedEvent?.start_time}
                end={resolvedEvent?.end_time}
                opensMinutes={resolvedEvent?.check_in_opens_minutes}
                pointValue={resolvedEvent?.point_value}
                eventUnavailable={eventUnavailable}
                zone={
                  hasCheckInZone
                    ? "zone"
                    : checkInZoneIsMalformed
                      ? "malformed"
                      : "none"
                }
              />
            ) : null}
            <div className="rounded-lg border border-border p-3">
              <p className="mb-2 flex items-center gap-1 text-caption text-muted-foreground">
                <RolesGlyph className="h-3.5 w-3.5" />
                Who&apos;s coming
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isMandatory ? "destructive" : "secondary"}>
                  {attendance.everyone === "not_invited"
                    ? "Only the roles below"
                    : `${EVENT_ATTENDANCE_LABELS[attendance.everyone]} for everyone`}
                </Badge>
                {cadence ? <Badge variant="outline">{cadence}</Badge> : null}
              </div>
              {Object.keys(attendance.roles).length > 0 ? (
                <ul className="mt-2 grid gap-1">
                  {Object.entries(attendance.roles).map(([id, status]) => (
                    <li
                      key={id}
                      className="flex items-center justify-between gap-3 text-sm"
                    >
                      <span className="truncate">
                        {roleNameById.get(id) ??
                          (rolesQuery.isSuccess ? "Removed role" : "Role")}
                      </span>
                      <span className="shrink-0 text-muted-foreground">
                        {EVENT_ATTENDANCE_LABELS[status]}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
              <div className="mt-3">
                <p className="mb-1 flex items-center gap-1 text-caption text-muted-foreground">
                  <StudyZonesGlyph className="h-3.5 w-3.5" />
                  Check-in zone
                </p>
                {hasCheckInZone ? (
                  <p className="text-sm">{checkInZoneLine(checkInZoneName)}</p>
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
              <p className="mb-2 text-caption text-muted-foreground">
                Schedule
              </p>
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

            {/*
              The series right under the meeting it opened, ahead of the long
              attendance roster (#3707): the list shows a repeating event once,
              so this is where its other dates live.
            */}
            {series && series.length > 1 ? (
              <section
                aria-labelledby="event-series-label"
                className="rounded-lg border border-border p-3"
              >
                <p
                  id="event-series-label"
                  className="mb-1 text-caption text-muted-foreground"
                >
                  Upcoming in this series
                </p>
                <ul role="list" className="grid gap-0.5">
                  {series.map((occurrence) => {
                    const occurrenceId =
                      typeof occurrence.id === "string" ? occurrence.id : "";
                    const isOpen = occurrenceId === eventId;
                    const when =
                      formatDayTime(occurrence.start_time) ?? "Date not set";
                    return (
                      <li key={occurrenceId || when}>
                        <button
                          type="button"
                          aria-current={isOpen ? "true" : undefined}
                          disabled={isOpen || !onSelectOccurrence}
                          onClick={() => onSelectOccurrence?.(occurrence)}
                          className={cn(
                            "flex min-h-9 w-full items-center rounded-md px-2 text-left text-sm transition-colors pointer-coarse:min-h-11",
                            isOpen
                              ? "bg-accent-subtle font-semibold text-accent-text"
                              : "hover:bg-card-hover",
                            FOCUS_RING_OFFSET,
                          )}
                        >
                          {when}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ) : null}

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

            {eventId && !usingPreviewData ? (
              <EventMinutes eventId={eventId} eventName={eventName} />
            ) : null}

            {notes ? (
              <div className="rounded-lg border border-border p-3">
                <p className="mb-1 text-caption text-muted-foreground">
                  {meetingsOn ? "Notes" : "Meeting minutes"}
                </p>
                {/* Same plain-text convention as chat's TextRenderer (#369 owns
                  a real markdown renderer if that lands later) — preserve the
                  line breaks admins typed instead of collapsing them. */}
                <p className="whitespace-pre-wrap break-words text-sm">
                  {notes}
                </p>
              </div>
            ) : null}

            {/*
              The roster is `events:update` on the server, so it mounts only
              for a viewer who holds it: mounted for a member, its read 403'd
              and the sheet said "Your role can't do this" where their own
              check-in belonged (#3855). `<Can>` holds it back while
              permissions load, so it never mounts and fires that read first.
            */}
            {eventId && !usingPreviewData ? (
              <Can
                permission="events:update"
                offlineFallback={(retry) => (
                  <PermissionsOfflineSurface
                    description="Reconnect to see who checked in to this event."
                    onRetry={retry}
                  />
                )}
              >
                <AttendancePanel
                  // Keyed by meeting: opening another one from the series
                  // list starts its roster fresh, filter included.
                  key={eventId}
                  eventId={eventId}
                  eventStart={resolvedEvent?.start_time}
                  eventEnd={resolvedEvent?.end_time}
                />
              </Can>
            ) : null}
          </div>
        </PanelBody>
        {confirmDialog}
      </PanelContent>
    </Panel>
  );
}
