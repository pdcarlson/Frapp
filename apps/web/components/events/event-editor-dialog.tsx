"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  ChevronDown,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";
import {
  RolesGlyph,
  StudyZonesGlyph,
} from "@/components/events/chapter-ops-glyphs";
import { AttendanceEditor } from "@/components/events/attendance-editor";
import { MoreOptionsToggle } from "@/components/ui/more-options-toggle";
import { useCreateEvent, useRoles, useUpdateEvent } from "@repo/hooks";
import {
  RECURRENCE_REPEAT_LABELS,
  RECURRENCE_RULES,
  attendanceFieldsOf,
  attendanceFromEvent,
  attendanceToWire,
  describeAttendance,
  emptyAttendanceDraft,
  isRecurrenceRule,
  describeSeriesLength,
  type EventAttendanceDraft,
} from "@repo/validation";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/ui/sheet";
import {
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { dashboardFormSelectClassName } from "@/components/shared/table-controls";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { normalizeRoleOptions } from "@/lib/roles";
import {
  cn,
  getErrorMessage,
  guardIntDraft,
  parseGuardedInt,
} from "@/lib/utils";
import { parseInstant } from "@repo/formatting";

type EventRecord = Record<string, unknown>;

export function isoToLocalInput(value: unknown): string {
  const date = parseInstant(value);
  if (!date) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string {
  const date = parseInstant(value);
  if (!date) return "";
  return date.toISOString();
}

/**
 * One editable polygon corner.
 *
 * `lat`/`lng` stay strings so a half-typed value ("-", "42.") survives a
 * controlled re-render instead of being coerced to NaN on every keystroke; they
 * are parsed once, in `parseZoneDrafts`, on submit. `id` is a stable React key
 * so reordering rows moves the values rather than the focus.
 */
type ZoneVertexDraft = { id: string; lat: string; lng: string };

let vertexKeySequence = 0;
function nextVertexKey(): string {
  vertexKeySequence += 1;
  return `zone-vertex-${vertexKeySequence}`;
}

/**
 * Hydrate a stored polygon into editable rows.
 *
 * `check_in_zone` is `jsonb`, so a malformed row is possible in principle. Drop
 * anything that is not a finite `{lat,lng}` pair rather than rendering it as an
 * uneditable blank — the same fail-closed stance `isValidZone` takes on the
 * server (`apps/api/src/domain/utils/geofence.ts`).
 */
function zoneToDrafts(value: unknown): ZoneVertexDraft[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((point) => {
    if (!point || typeof point !== "object") return [];
    const { lat, lng } = point as { lat?: unknown; lng?: unknown };
    if (typeof lat !== "number" || !Number.isFinite(lat)) return [];
    if (typeof lng !== "number" || !Number.isFinite(lng)) return [];
    return [{ id: nextVertexKey(), lat: String(lat), lng: String(lng) }];
  });
}

type ZoneParseResult =
  | { ok: true; zone: { lat: number; lng: number }[] }
  | { ok: false; message: string };

/**
 * Turn the draft rows into the wire polygon, or explain why they are not one.
 *
 * Wholly blank rows are ignored, so an accidental empty row does not become a
 * validation error. The under-3 message deliberately echoes the server's own
 * wording in `normalizeCheckInZone` (`event-input.ts`) so the client message
 * and the API 400 cannot drift apart.
 */
function parseZoneDrafts(drafts: ZoneVertexDraft[]): ZoneParseResult {
  // Carry each row's original position through the filter: the label below has
  // to name the row the officer sees, and dropping blank rows renumbers them.
  const rows = drafts
    .map((row, index) => ({ row, index }))
    .filter(
      ({ row }) => row.lat.trim().length > 0 || row.lng.trim().length > 0,
    );
  if (rows.length === 0) return { ok: true, zone: [] };

  const zone: { lat: number; lng: number }[] = [];
  for (const { row, index } of rows) {
    const label = `Point ${index + 1}`;
    const latText = row.lat.trim();
    const lngText = row.lng.trim();
    // `Number("")` is 0, not NaN, so a row with one field filled would sail
    // through the finite check below and persist the blank half as a real
    // coordinate on the equator or the prime meridian.
    if (latText.length === 0 || lngText.length === 0) {
      return {
        ok: false,
        message: `${label} needs both a latitude and a longitude.`,
      };
    }
    const lat = Number(latText);
    const lng = Number(lngText);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      return {
        ok: false,
        message: `${label} needs a numeric latitude and longitude.`,
      };
    }
    if (lat < -90 || lat > 90) {
      return {
        ok: false,
        message: `${label}: latitude must be between -90 and 90.`,
      };
    }
    if (lng < -180 || lng > 180) {
      return {
        ok: false,
        message: `${label}: longitude must be between -180 and 180.`,
      };
    }
    zone.push({ lat, lng });
  }

  if (zone.length < 3) {
    return {
      ok: false,
      message:
        "A check-in zone must have at least 3 points, or be empty to clear it.",
    };
  }
  return { ok: true, zone };
}

type EventEditorDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /**
   * Forwarded to the underlying `PanelContent`. `useGatedDialog` splits its
   * contract across `dialogProps` and `contentProps`; `events-page.tsx` owns
   * `open` while this component owns the content, so without this the revoke
   * path falls back to Radix's default and refocuses a "New event" trigger that
   * just went `disabled` — dropping focus to `<body>`.
   */
  onCloseAutoFocus?: (event: Event) => void;
  mode: "create" | "edit";
  event: EventRecord | null;
  usingPreviewData: boolean;
  onSaved: () => Promise<void> | void;
  /**
   * Prefill for a fresh create — e.g. the calendar view's click-to-create.
   * `datetime-local` value strings, matching `isoToLocalInput`'s output.
   * Ignored in edit mode, where `event`'s own schedule always wins.
   */
  initialStartAt?: string;
  initialEndAt?: string;
};

export function EventEditorDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  mode,
  event,
  usingPreviewData,
  onSaved,
  initialStartAt,
  initialEndAt,
}: EventEditorDialogProps) {
  const createEventMutation = useCreateEvent();
  const updateEventMutation = useUpdateEvent();
  // `POST /v1/events` and `PATCH /v1/events/:id` carry no `@FreeTier`, so both
  // are paid-ops and this dialog has to mirror the subscription gate (#841).
  const gate = useSubscriptionGate();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  // Held as text so a cleared field stays cleared while the officer types,
  // rather than React writing 0 back into it. An empty field still saves as 0.
  const [pointValue, setPointValue] = useState("10");
  // Optional for everyone until the officer says otherwise, as the mobile
  // sheet and `/event` create it: a required event marks everyone who misses
  // it absent, so it is a choice, not a default.
  const [attendance, setAttendance] =
    useState<EventAttendanceDraft>(emptyAttendanceDraft);
  const [recurrenceRule, setRecurrenceRule] = useState("NONE");
  const [notes, setNotes] = useState("");
  // Closed on create, so the form opens on the four fields every event needs;
  // open on edit, where the officer came to change something.
  const [showMore, setShowMore] = useState(false);
  const [showZone, setShowZone] = useState(false);
  const [checkInZone, setCheckInZone] = useState<ZoneVertexDraft[]>([]);
  const [checkInZoneName, setCheckInZoneName] = useState("");
  const rolesQuery = useRoles();

  const eventId = typeof event?.id === "string" ? event.id : "";
  const isSubmitting =
    createEventMutation.isPending || updateEventMutation.isPending;

  const roleOptions = useMemo(
    () =>
      normalizeRoleOptions(rolesQuery.data).sort((first, second) =>
        first.name.localeCompare(second.name),
      ),
    [rolesQuery.data],
  );

  // A role set on the event but missing from the list (deleted since, or the
  // list still loading) stays a removable row reading "Removed role" in the
  // editor, so an unseen id is never saved back without the officer seeing it.
  const roleName = useMemo(() => {
    const byId = new Map(roleOptions.map((role) => [role.id, role.name]));
    return (id: string) => byId.get(id);
  }, [roleOptions]);

  /* eslint-disable react-hooks/set-state-in-effect -- hydrate or reset the form when the dialog opens on a different event */
  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && event) {
      setName(typeof event.name === "string" ? event.name : "");
      setDescription(
        typeof event.description === "string" ? event.description : "",
      );
      setLocation(typeof event.location === "string" ? event.location : "");
      setStartAt(isoToLocalInput(event.start_time));
      setEndAt(isoToLocalInput(event.end_time));
      setPointValue(
        String(typeof event.point_value === "number" ? event.point_value : 10),
      );
      setAttendance(attendanceFromEvent(attendanceFieldsOf(event)));
      setRecurrenceRule(
        typeof event.recurrence_rule === "string" &&
          event.recurrence_rule.length > 0
          ? event.recurrence_rule
          : "NONE",
      );
      setNotes(typeof event.notes === "string" ? event.notes : "");
      setCheckInZone(zoneToDrafts(event.check_in_zone));
      setShowMore(true);
      setShowZone(zoneToDrafts(event.check_in_zone).length > 0);
      setCheckInZoneName(
        typeof event.check_in_zone_name === "string"
          ? event.check_in_zone_name
          : "",
      );
      return;
    }

    setName("");
    setDescription("");
    setLocation("");
    setStartAt(initialStartAt ?? "");
    setEndAt(initialEndAt ?? "");
    setPointValue("10");
    setAttendance(emptyAttendanceDraft());
    setRecurrenceRule("NONE");
    setNotes("");
    setCheckInZone([]);
    setCheckInZoneName("");
    setShowMore(false);
    setShowZone(false);
  }, [event, mode, open, initialStartAt, initialEndAt]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return mode === "create" ? "Creating..." : "Saving...";
    }
    return mode === "create" ? "Create event" : "Save changes";
  }, [isSubmitting, mode]);

  const handlePointValueChange = (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    // A negative or a decimal keeps the previous value.
    const next = guardIntDraft(event.target.value);
    if (next !== undefined) setPointValue(next);
  };

  function handleAddVertex() {
    setCheckInZone((previous) => [
      ...previous,
      { id: nextVertexKey(), lat: "", lng: "" },
    ]);
  }

  function handleRemoveVertex(id: string) {
    setCheckInZone((previous) => previous.filter((row) => row.id !== id));
  }

  function handleVertexChange(id: string, axis: "lat" | "lng", value: string) {
    setCheckInZone((previous) =>
      previous.map((row) => (row.id === id ? { ...row, [axis]: value } : row)),
    );
  }

  // Vertex order defines the polygon's edges, so reordering is a real edit, not
  // a display preference: swapping two corners of a quadrilateral turns it into
  // a bow-tie covering different ground.
  function handleMoveVertex(index: number, direction: -1 | 1) {
    setCheckInZone((previous) => {
      const target = index + direction;
      const moved = previous[index];
      const displaced = previous[target];
      if (!moved || !displaced) return previous;
      const next = [...previous];
      next[index] = displaced;
      next[target] = moved;
      return next;
    });
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast({
        title: "Event name required",
        description: "Add a clear event title before saving.",
        variant: "destructive",
      });
      return;
    }
    const startIso = localInputToIso(startAt);
    const endIso = localInputToIso(endAt);
    if (!startIso || !endIso) {
      toast({
        title: "Valid schedule required",
        description: "Provide both start and end times.",
        variant: "destructive",
      });
      return;
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      toast({
        title: "Valid schedule required",
        description: "End must be after start.",
        variant: "destructive",
      });
      return;
    }

    const parsedZone = parseZoneDrafts(checkInZone);
    if (!parsedZone.ok) {
      toast({
        title: "Check-in zone is incomplete",
        description: parsedZone.message,
        variant: "destructive",
      });
      return;
    }
    const zone = parsedZone.zone;
    const zoneName = checkInZoneName.trim();

    // An empty field saves as 0 points, as it always has. Anything else that
    // isn't a whole number of 0 or more is refused rather than zeroed: typing
    // can't leave one, but a stored value seeded on edit could.
    const pointValueNumber =
      pointValue.trim() === "" ? 0 : parseGuardedInt(pointValue);
    if (pointValueNumber === undefined) {
      toast({
        title: "Valid point value required",
        description: "Use a whole number of 0 or more.",
        variant: "destructive",
      });
      return;
    }

    const wire = attendanceToWire(attendance);
    if (
      !wire.others_invited &&
      wire.required_role_ids.length === 0 &&
      wire.optional_role_ids.length === 0
    ) {
      setShowMore(true);
      toast({
        title: "Nobody is invited",
        description: "Add a role, or invite everyone.",
        variant: "destructive",
      });
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      location: location.trim() || undefined,
      start_time: startIso,
      end_time: endIso,
      point_value: pointValueNumber,
      // Always sent with the role lists: omitted beside `required_role_ids`,
      // the API would read the older "only these roles" meaning.
      is_mandatory: wire.is_mandatory,
      others_invited: wire.others_invited,
      recurrence_rule: recurrenceRule === "NONE" ? undefined : recurrenceRule,
      notes: notes.trim() || undefined,
    };

    try {
      if (mode === "create") {
        // Role lists are omitted when empty on create; on update (below)
        // every list is sent, so an emptied one clears.
        //
        // check_in_zone follows the same omit-on-create rule, but for a harder
        // reason: CreateEventDto carries @ArrayMinSize(3), so sending [] here is
        // a 400 rather than "no zone". Update deliberately omits that decorator
        // so [] can clear — see the update branch below.
        await createEventMutation.mutateAsync({
          ...payload,
          ...(wire.required_role_ids.length > 0
            ? { required_role_ids: wire.required_role_ids }
            : {}),
          ...(wire.optional_role_ids.length > 0
            ? { optional_role_ids: wire.optional_role_ids }
            : {}),
          ...(wire.excluded_role_ids.length > 0
            ? { excluded_role_ids: wire.excluded_role_ids }
            : {}),
          ...(zone.length > 0
            ? {
                check_in_zone: zone,
                ...(zoneName ? { check_in_zone_name: zoneName } : {}),
              }
            : {}),
        });
        toast({
          title: "Event created",
          description: `${payload.name} was added to the chapter calendar.`,
        });
      } else {
        if (!eventId) return;
        await updateEventMutation.mutateAsync({
          id: eventId,
          body: {
            ...payload,
            required_role_ids: wire.required_role_ids,
            optional_role_ids: wire.optional_role_ids,
            excluded_role_ids: wire.excluded_role_ids,
            // Always sent, so emptying the editor clears the stored zone:
            // UpdateEventDto omits @ArrayMinSize and normalizeCheckInZone maps
            // [] to null. The name is cleared alongside it — a leftover name on
            // a zone-less event is inert but misleading in the editor.
            check_in_zone: zone,
            check_in_zone_name: zone.length > 0 ? zoneName : "",
          },
        });
        toast({
          title: "Event updated",
          description: `${payload.name} was updated successfully.`,
        });
      }
    } catch (error) {
      toast({
        title:
          mode === "create"
            ? "Could not create event"
            : "Could not update event",
        description: getErrorMessage(
          error,
          "Something went wrong. Please retry.",
        ),
        variant: "destructive",
      });
      return;
    }

    onOpenChange(false);
    try {
      await onSaved();
    } catch {
      toast({
        title: "Event saved",
        description:
          "The event was saved, but this view could not refresh automatically.",
        variant: "destructive",
      });
    }
  }

  const repeatStart = parseInstant(localInputToIso(startAt));
  const repeatNote =
    repeatStart && isRecurrenceRule(recurrenceRule)
      ? describeSeriesLength(repeatStart, recurrenceRule)
      : null;
  const moreSummary = [
    `${pointValue.trim() === "" ? 0 : pointValue} pts`,
    describeAttendance(attendance, roleName),
    isRecurrenceRule(recurrenceRule)
      ? RECURRENCE_REPEAT_LABELS[recurrenceRule]
      : "Doesn't repeat",
  ].join(" · ");

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      {/*
        A panel, not a dialog (`components.md` § Surface size): this form runs
        to a role list and a polygon of any length, so it scrolled inside a
        672px dialog capped at 90vh. It opens at the event panel's own width,
        so Edit event reads as that panel turning into its editor.

        No description: the one this had restated the form's own fields.
        `aria-describedby={undefined}` tells Radix the omission is deliberate.
      */}
      <PanelContent
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
      >
        <PanelHeader>
          {mode === "create" ? "Create event" : "Edit event"}
        </PanelHeader>

        <PanelBody>
          {usingPreviewData ? (
            <div className="flex items-start gap-3 rounded-md border border-warning/45 bg-warning-tint p-3 text-caption text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Preview mode is active. Sign in to create and edit live events.
              </div>
            </div>
          ) : null}

          {/*
          §5 rule 1 wants the gate on the trigger, but "New event" / "Edit"
          live in the parents that own `open` (events-page, event-detail-sheet),
          so the earliest point this component controls is the top of the form.
          The notice therefore states the blocker before anything is typed,
          rather than leaving the save button disabled with no reason.
        */}
          <SubscriptionNotice gate={gate} feature="managing events" />

          <div className="grid gap-3">
            <div className="grid gap-1">
              <Label htmlFor="event-name">Event name</Label>
              <Input
                id="event-name"
                value={name}
                onChange={(eventValue) => setName(eventValue.target.value)}
                placeholder="Chapter meeting"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="grid gap-1">
                <Label htmlFor="event-start">Start</Label>
                <Input
                  id="event-start"
                  type="datetime-local"
                  value={startAt}
                  onChange={(eventValue) => setStartAt(eventValue.target.value)}
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor="event-end">End</Label>
                <Input
                  id="event-end"
                  type="datetime-local"
                  value={endAt}
                  onChange={(eventValue) => setEndAt(eventValue.target.value)}
                />
              </div>
            </div>

            <div className="grid gap-1">
              <Label htmlFor="event-location">Location</Label>
              <Input
                id="event-location"
                value={location}
                onChange={(eventValue) => setLocation(eventValue.target.value)}
                placeholder="Chapter house"
              />
            </div>

            {/*
              Everything past the four fields every event needs waits behind
              one row, which says what it holds while closed (owner,
              2026-11-06: nobody wants every option at once on create).
            */}
            <MoreOptionsToggle
              open={showMore}
              onToggle={() => setShowMore((open) => !open)}
              summary={moreSummary}
              controls="event-more-options"
            />

            {showMore ? (
              <div id="event-more-options" className="grid gap-4">
                <section className="grid gap-2" aria-label="Who's coming">
                  <div className="flex items-center gap-2 text-sm">
                    <RolesGlyph className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-muted-foreground">
                      Who&apos;s coming
                    </span>
                  </div>
                  <AttendanceEditor
                    value={attendance}
                    onChange={setAttendance}
                    roles={roleOptions}
                    rolesState={
                      rolesQuery.isError
                        ? "error"
                        : rolesQuery.isLoading
                          ? "loading"
                          : "ready"
                    }
                    disabled={usingPreviewData}
                  />
                </section>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="grid gap-1">
                    <Label htmlFor="event-recurrence">Repeat</Label>
                    <select
                      id="event-recurrence"
                      value={recurrenceRule}
                      onChange={(eventValue) =>
                        setRecurrenceRule(eventValue.target.value)
                      }
                      className={dashboardFormSelectClassName}
                    >
                      <option value="NONE">Doesn&apos;t repeat</option>
                      {RECURRENCE_RULES.map((rule) => (
                        <option key={rule} value={rule}>
                          {RECURRENCE_REPEAT_LABELS[rule]}
                        </option>
                      ))}
                    </select>
                    {repeatNote ? (
                      <p className="text-caption text-muted-foreground">
                        {repeatNote}
                      </p>
                    ) : null}
                  </div>
                  <div className="grid content-start gap-1">
                    <Label htmlFor="event-point-value">
                      Points for attending
                    </Label>
                    <Input
                      id="event-point-value"
                      type="number"
                      min={0}
                      value={pointValue}
                      onChange={handlePointValueChange}
                    />
                  </div>
                </div>

                <div className="grid gap-1">
                  <Label htmlFor="event-description">Description</Label>
                  <Textarea
                    id="event-description"
                    value={description}
                    onChange={(eventValue) =>
                      setDescription(eventValue.target.value)
                    }
                    rows={3}
                    className="min-h-[96px]"
                    placeholder="What members should know before they come."
                  />
                </div>

                <div className="grid gap-2 text-sm">
                  <button
                    type="button"
                    aria-expanded={showZone}
                    onClick={() => setShowZone((open) => !open)}
                    className="flex min-h-9 items-center gap-2 text-left"
                  >
                    <StudyZonesGlyph className="h-4 w-4 text-muted-foreground" />
                    <span className="font-semibold text-muted-foreground">
                      Check-in zone
                    </span>
                    <span className="text-caption text-muted-foreground">
                      {checkInZone.length > 0
                        ? `${checkInZone.length} points`
                        : "None, members check in from anywhere"}
                    </span>
                    <ChevronDown
                      className={cn(
                        "ml-auto h-4 w-4 text-muted-foreground transition-transform",
                        showZone && "rotate-180",
                      )}
                    />
                  </button>
                  {showZone ? (
                    <div className="space-y-2">
                      <p className="text-caption text-muted-foreground">
                        Optional. Members must be inside it to check in. At
                        least 3 points; don&apos;t repeat the first.
                      </p>

                      <div className="grid gap-1">
                        <Label htmlFor="event-zone-name">Zone name</Label>
                        <Input
                          id="event-zone-name"
                          value={checkInZoneName}
                          maxLength={120}
                          disabled={usingPreviewData}
                          onChange={(eventValue) =>
                            setCheckInZoneName(eventValue.target.value)
                          }
                          placeholder="Great Hall"
                        />
                      </div>

                      {checkInZone.length === 0 ? (
                        <div className="rounded-md border border-dashed border-border p-3 text-caption text-muted-foreground">
                          No check-in zone. Members can check in from anywhere.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {checkInZone.map((vertex, index) => (
                            <div
                              key={vertex.id}
                              className="flex flex-wrap items-end gap-2 rounded-md border border-border p-3"
                            >
                              <div className="grid min-w-[9rem] flex-1 gap-1">
                                <Label htmlFor={`${vertex.id}-lat`}>
                                  Point {index + 1} latitude
                                </Label>
                                <Input
                                  id={`${vertex.id}-lat`}
                                  value={vertex.lat}
                                  inputMode="decimal"
                                  disabled={usingPreviewData}
                                  onChange={(eventValue) =>
                                    handleVertexChange(
                                      vertex.id,
                                      "lat",
                                      eventValue.target.value,
                                    )
                                  }
                                  placeholder="42.7298"
                                />
                              </div>
                              <div className="grid min-w-[9rem] flex-1 gap-1">
                                <Label htmlFor={`${vertex.id}-lng`}>
                                  Point {index + 1} longitude
                                </Label>
                                <Input
                                  id={`${vertex.id}-lng`}
                                  value={vertex.lng}
                                  inputMode="decimal"
                                  disabled={usingPreviewData}
                                  onChange={(eventValue) =>
                                    handleVertexChange(
                                      vertex.id,
                                      "lng",
                                      eventValue.target.value,
                                    )
                                  }
                                  placeholder="-73.6789"
                                />
                              </div>
                              <div className="flex items-center gap-1">
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Move point ${index + 1} up`}
                                  disabled={usingPreviewData || index === 0}
                                  onClick={() => handleMoveVertex(index, -1)}
                                >
                                  <ArrowUp className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Move point ${index + 1} down`}
                                  disabled={
                                    usingPreviewData ||
                                    index === checkInZone.length - 1
                                  }
                                  onClick={() => handleMoveVertex(index, 1)}
                                >
                                  <ArrowDown className="h-4 w-4" />
                                </Button>
                                <Button
                                  type="button"
                                  variant="ghost"
                                  size="icon"
                                  aria-label={`Remove point ${index + 1}`}
                                  disabled={usingPreviewData}
                                  onClick={() => handleRemoveVertex(vertex.id)}
                                >
                                  <Trash2 className="h-4 w-4" />
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}

                      <Button
                        type="button"
                        variant="secondary"
                        disabled={usingPreviewData}
                        onClick={handleAddVertex}
                      >
                        <Plus className="h-4 w-4" />
                        Add point
                      </Button>
                    </div>
                  ) : null}
                </div>

                {mode === "edit" ? (
                  <div className="grid gap-1">
                    <Label htmlFor="event-meeting-minutes">
                      Meeting minutes
                    </Label>
                    <Textarea
                      id="event-meeting-minutes"
                      value={notes}
                      onChange={(eventValue) =>
                        setNotes(eventValue.target.value)
                      }
                      rows={2}
                      placeholder="Visible to members who can see this event."
                    />
                  </div>
                ) : null}
              </div>
            ) : null}
          </div>
        </PanelBody>

        <PanelFooter>
          {/* Cancel only closes the panel — gating the way out of a surface the
              gate just blocked would be a trap. */}
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            {...gate.controlProps(usingPreviewData || isSubmitting)}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {submitLabel}
          </Button>
        </PanelFooter>
      </PanelContent>
    </Sheet>
  );
}
