"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
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
import { EventTypePicker } from "@/components/events/event-type-picker";
import { MoreOptionsToggle } from "@/components/ui/more-options-toggle";
import {
  EVENT_CREATE_UNCONFIRMED,
  useCreateEvent,
  useEvent,
  useEvents,
  useMyPermissions,
  useRoles,
  useUpdateEvent,
  type EventType,
} from "@repo/hooks";
import {
  attendanceFieldsOf,
  attendanceFromEvent,
  attendanceInvitesNobody,
  attendanceToWire,
  can,
  othersInvitedForCreate,
  withEveryone,
  describeAttendance,
  emptyAttendanceDraft,
  eventLimitsAudience,
  eventRequiresAnyone,
  eventEditPatch,
  isEmptyEventPatch,
  leavesAfterSave,
  noRepeatDraft,
  REPEAT_PRESET_LABELS,
  repeatDraftFromRule,
  repeatEditAnchor,
  repeatEditDraft,
  repeatEditSeriesOf,
  seriesStartsIn,
  repeatRuleForEdit,
  repeatRuleOf,
  repeatSummary,
  saveRequestFor,
  saveScopeFor,
  SERIES_SCOPE_COPY,
  type EventAttendanceDraft,
  type EventEditScope,
  type RepeatDraft,
  type RepeatEditSeries,
} from "@repo/validation";
import { MemberFacingError } from "@repo/hooks/error-copy";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { editTargetOf } from "@/components/events/edit-target";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { pointsLabel } from "@/components/events/event-labels";
import { RepeatOptions } from "@/components/events/repeat-options";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelFooter,
  PanelHeader,
} from "@/components/shared/panel";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  SubscriptionNotice,
  useSubscriptionGate,
} from "@/components/shared/subscription-gate";
import { toRoleOptions } from "@repo/hooks/chapter-roles";
import {
  cn,
  getErrorMessage,
  guardIntDraft,
  parseGuardedInt,
} from "@/lib/utils";
import { parseInstant } from "@repo/formatting";
import { randomClientId, statusOf } from "@repo/api-sdk";
import {
  eventCardOutcomeCopy,
  type EventCardTrack,
} from "@repo/chat-core/dispatch";

type EventRecord = Record<string, unknown>;

const textOf = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

export function isoToLocalInput(value: unknown): string {
  const date = parseInstant(value);
  if (!date) return "";
  const timezoneOffset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - timezoneOffset).toISOString().slice(0, 16);
}

function localInputToIso(value: string): string {
  // The editor holds a day and a time apart; either may still be empty.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const date = parseInstant(value);
  if (!date) return "";
  return date.toISOString();
}

/**
 * One end of an event's schedule: a day typed without a year (`DateField`,
 * leaning ahead) beside the browser's time input. The value is the
 * `YYYY-MM-DDTHH:MM` the editor has always held, with either half empty
 * until it is filled in.
 */
function ScheduleEnd({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const [day = "", time = ""] = value.split("T");
  const join = (nextDay: string, nextTime: string) =>
    nextDay || nextTime ? `${nextDay}T${nextTime}` : "";
  return (
    <fieldset className="grid gap-1">
      <legend className="mb-1 text-sm font-semibold leading-none">
        {label}
      </legend>
      <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
        <DateField
          id={id}
          aria-label={`${label}, day`}
          placeholder="e.g. Friday"
          lean="ahead"
          value={day}
          onChange={(nextDay) => onChange(join(nextDay, time))}
        />
        <Input
          id={`${id}-time`}
          aria-label={`${label}, time`}
          type="time"
          step={300}
          value={time}
          onChange={(event) => onChange(join(day, event.target.value))}
        />
      </div>
    </fieldset>
  );
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

/**
 * The toast after a create. From chat (#3773) the card is the point, so a
 * create that couldn't post one says why rather than leaving the member to
 * wonder where it went. Neither case is a failure: the event exists.
 */
function createdToast(
  name: string,
  card: { cardKeptOut: boolean; cardLost: boolean },
): { title: string; description: string } {
  return {
    title: "Event created",
    description:
      eventCardOutcomeCopy(name, card) ??
      `${name} was added to the chapter calendar.`,
  };
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
   * Told, before the panel closes, that a series save rebuilt or moved the
   * event it was opened on (`leavesAfterSave`), so the caller doesn't go back
   * to that event's view: its id may be gone.
   */
  onLeftEvent?: () => void;
  /**
   * Open inside the Events page instead of over the app (`shared/panel.tsx`
   * § Docked). `/event` in chat has no page to open in and keeps the sheet.
   */
  docked?: boolean;
  /** The docked back arrow's name: where it returns to. */
  backLabel?: string;
  /**
   * Prefill for a fresh create — e.g. the calendar view's click-to-create.
   * `datetime-local` value strings, matching `isoToLocalInput`'s output.
   * Ignored in edit mode, where `event`'s own schedule always wins.
   */
  initialStartAt?: string;
  initialEndAt?: string;
  /**
   * More create-only prefill, from what a member typed after `/event` in chat
   * (#3773). Ignored in edit mode.
   */
  initialName?: string;
  initialLocation?: string;
  initialPointValue?: number;
  /**
   * An earlier event a fresh create starts as a copy of (#3930, "this time
   * last year"): its name, description, location, points, who it is for,
   * notes, type and check-in zone. Never its schedule or its repeat, which
   * come from `initialStartAt` / `initialEndAt` and the officer. Ignored in
   * edit mode.
   */
  template?: EventRecord | null;
  /** Told the new event's id after a create, before `onSaved`. */
  onCreated?: (eventId: string) => Promise<void> | void;
  /**
   * The chat channel a create came from. The event's card posts there, as the
   * `/event` one-liner's does, unless the event keeps anyone out: the API
   * refuses a card for those, so they are created without one and the toast
   * says so. Ignored in edit mode.
   */
  postToChannelId?: string;
  /**
   * The chat's card bookkeeping for `postToChannelId` (`trackEventCard`): a
   * `loading` placeholder in the channel while the create runs, dropped on a
   * refusal, and kept as a durable "card didn't post" row when the event
   * committed without its card, as the one-liner does. Without it the create
   * still posts its card, with no placeholder.
   */
  trackChatCard?: (channelId: string, name: string) => EventCardTrack;
};

export function EventEditorDialog({
  open,
  onOpenChange,
  onCloseAutoFocus,
  mode,
  event,
  usingPreviewData,
  onSaved,
  onLeftEvent,
  docked = false,
  backLabel = "Back to events",
  initialStartAt,
  initialEndAt,
  initialName,
  initialLocation,
  initialPointValue,
  template,
  onCreated,
  postToChannelId,
  trackChatCard,
}: EventEditorDialogProps) {
  const createEventMutation = useCreateEvent();
  const updateEventMutation = useUpdateEvent();
  // `POST /v1/events` and `PATCH /v1/events/:id` carry no `@FreeTier`, so both
  // are paid-ops and this dialog has to mirror the subscription gate (#841).
  const gate = useSubscriptionGate();
  const { toast } = useToast();
  const { confirm, confirmDialog } = useConfirmDialog();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [location, setLocation] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  /**
   * A new start carries the end with it, keeping the event's length, the way
   * Google Calendar moves both: moving a meeting a day on shouldn't leave its
   * end behind, before its start.
   *
   * The day field reports every keystroke, through text it can't read yet
   * (`""`) and partial readings (`11/1` on the way to `11/15`). So the shift is
   * measured from the last start that was a whole date and time, not from the
   * previous keystroke: the partial steps then add up to the real move.
   */
  const lastWholeStart = useRef<Date | null>(null);
  const moveStart = (next: string) => {
    const before = lastWholeStart.current;
    const after = parseInstant(localInputToIso(next));
    const end = parseInstant(localInputToIso(endAt));
    setStartAt(next);
    if (after) lastWholeStart.current = after;
    if (before && after && end) {
      setEndAt(
        isoToLocalInput(
          new Date(
            end.getTime() + after.getTime() - before.getTime(),
          ).toISOString(),
        ),
      );
    }
  };
  // Held as text so a cleared field stays cleared while the officer types,
  // rather than React writing 0 back into it. An empty field still saves as 0.
  const [pointValue, setPointValue] = useState("10");
  // Optional for everyone until the officer says otherwise, as the mobile
  // sheet and `/event` create it: a required event marks everyone who misses
  // it absent, so it is a choice, not a default.
  const [attendance, setAttendance] =
    useState<EventAttendanceDraft>(emptyAttendanceDraft);
  // The Repeat section (`repeat-draft.ts` in `@repo/validation`).
  const [repeat, setRepeat] = useState<RepeatDraft>(() => noRepeatDraft());
  const [notes, setNotes] = useState("");
  // The chapter's event type this is made as, or none (#3730). Picking one
  // only fills the form; the event keeps its own points and attendance.
  const [eventTypeId, setEventTypeId] = useState<string | null>(null);
  // The name the last picked type wrote into the name field, so picking a
  // different type replaces it but never a name the officer typed.
  const [typeFilledName, setTypeFilledName] = useState<string | null>(null);
  // Closed on create, so the form opens on the four fields every event needs;
  // open on edit, where the officer came to change something.
  const [showMore, setShowMore] = useState(false);
  const [showZone, setShowZone] = useState(false);
  const [checkInZone, setCheckInZone] = useState<ZoneVertexDraft[]>([]);
  const [checkInZoneName, setCheckInZoneName] = useState("");
  const rolesQuery = useRoles();
  // Adding or changing a type is `events:update` on the server; anyone who
  // can open this form may pick one.
  const { data: permissionsPayload } = useMyPermissions();
  const canManageTypes = can("events:update", permissionsPayload?.permissions);
  // The same permission decides who makes anyone required or attaches
  // points (#3709): a member who may only create events makes optional
  // events worth no points, and the API holds them to it
  // (`EventService.create`). Editing takes `events:update` anyway.
  const canSetRequirements = canManageTypes;

  // A generated meeting carries no rule of its own: its series' rule and
  // first start live on its parent, read here as the phone does
  // (`event-details.tsx`). A series time change goes to it as a shift.
  const parentId =
    mode === "edit" && typeof event?.parent_event_id === "string"
      ? event.parent_event_id
      : "";
  const parentQuery = useEvent(usingPreviewData ? "" : parentId);
  // The chapter's events, for the series' real next meeting: a Repeat change
  // on a started series steps from it (`repeatEditAnchor`, #4746). Read only
  // when editing a series; the Events page has the list cached already.
  const seriesListQuery = useEvents({
    enabled:
      mode === "edit" &&
      !usingPreviewData &&
      (parentId !== "" || !!textOf(event?.recurrence_rule)),
  });
  const editTarget = useMemo(() => {
    if (mode !== "edit") return null;
    const target = editTargetOf(
      event,
      parentQuery.data && typeof parentQuery.data === "object"
        ? (parentQuery.data as EventRecord)
        : null,
    );
    return target
      ? {
          ...target,
          seriesStarts: seriesStartsIn(target, seriesListQuery.data),
        }
      : null;
  }, [mode, event, parentQuery.data, seriesListQuery.data]);
  // A generated meeting waits for its parent before it saves, as the phone's
  // Edit does (`event-details.tsx`): until then "All upcoming events" can't be
  // offered, and a save would go to this meeting alone without asking. A
  // series also waits for the chapter's events while they load, so a Repeat
  // change steps from the real next meeting, not a guess (#4746). A list
  // read that fails leaves the guess from the rule.
  const parentLoading =
    !usingPreviewData &&
    ((parentId !== "" && parentQuery.isPending) || seriesListQuery.isLoading);
  // Repeat waits for the parent: without it the series' rule is unknown.
  const repeatLocked =
    (!!editTarget?.event.parent_event_id && editTarget.parent === null) ||
    parentLoading;
  const repeatSeriesAt = (
    start: Date,
    now: Date,
  ): RepeatEditSeries | undefined =>
    editTarget && !repeatLocked
      ? repeatEditSeriesOf(editTarget, start, now)
      : undefined;
  const isSubmitting =
    createEventMutation.isPending || updateEventMutation.isPending;

  const roleOptions = useMemo(
    () =>
      toRoleOptions(rolesQuery.data, "hide").sort((first, second) =>
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
      lastWholeStart.current = parseInstant(event.start_time);
      setEndAt(isoToLocalInput(event.end_time));
      setPointValue(
        String(typeof event.point_value === "number" ? event.point_value : 10),
      );
      setAttendance(attendanceFromEvent(attendanceFieldsOf(event)));
      // A generated meeting's rule arrives with its parent (below).
      setRepeat(
        repeatDraftFromRule(editTargetOf(event, null)?.seriesRule ?? null),
      );
      setNotes(typeof event.notes === "string" ? event.notes : "");
      setEventTypeId(
        typeof event.event_type_id === "string" ? event.event_type_id : null,
      );
      setTypeFilledName(null);
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

    if (template) {
      const text = (value: unknown) => (typeof value === "string" ? value : "");
      const zone = zoneToDrafts(template.check_in_zone);
      setName(text(template.name));
      setDescription(text(template.description));
      setLocation(text(template.location));
      setStartAt(initialStartAt ?? "");
      // As the other two branches do: without it a start move here would be
      // measured from whatever the dialog last held (#4473).
      lastWholeStart.current = parseInstant(
        localInputToIso(initialStartAt ?? ""),
      );
      setEndAt(initialEndAt ?? "");
      setPointValue(
        String(
          typeof template.point_value === "number" ? template.point_value : 10,
        ),
      );
      setAttendance(attendanceFromEvent(attendanceFieldsOf(template)));
      setRepeat(noRepeatDraft());
      setNotes(text(template.notes));
      setEventTypeId(
        typeof template.event_type_id === "string"
          ? template.event_type_id
          : null,
      );
      setTypeFilledName(null);
      setCheckInZone(zone);
      setCheckInZoneName(text(template.check_in_zone_name));
      // Open, so nothing copied from last year is saved unseen.
      setShowMore(true);
      setShowZone(zone.length > 0);
      return;
    }

    setName(initialName ?? "");
    setDescription("");
    setLocation(initialLocation ?? "");
    setStartAt(initialStartAt ?? "");
    lastWholeStart.current = parseInstant(
      localInputToIso(initialStartAt ?? ""),
    );
    setEndAt(initialEndAt ?? "");
    setPointValue(String(initialPointValue ?? 10));
    setAttendance(emptyAttendanceDraft());
    setRepeat(noRepeatDraft());
    setNotes("");
    setEventTypeId(null);
    setTypeFilledName(null);
    setCheckInZone([]);
    setCheckInZoneName("");
    setShowMore(false);
    setShowZone(false);
  }, [
    template,
    event,
    mode,
    open,
    initialStartAt,
    initialEndAt,
    initialName,
    initialLocation,
    initialPointValue,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A generated meeting's rule arrives with its parent, after the form has
  // opened. Repeat is locked until then, so nothing typed is overwritten.
  const parentRule = editTarget?.parent ? editTarget.seriesRule : null;
  /* eslint-disable react-hooks/set-state-in-effect -- the parent's rule lands after the form hydrates */
  useEffect(() => {
    if (!open || parentRule === null) return;
    setRepeat(repeatDraftFromRule(parentRule));
  }, [open, parentRule]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return mode === "create" ? "Creating..." : "Saving...";
    }
    return mode === "create" ? "Create event" : "Save changes";
  }, [isSubmitting, mode]);

  /**
   * Picking a type fills in what it carries: its points, whether everyone
   * must attend (roles already set apart stay set apart), and its name when
   * the name is blank or still the one the last pick wrote. Letting the type
   * go leaves the form as it is.
   */
  function handlePickType(type: EventType | null) {
    setEventTypeId(type?.id ?? null);
    if (!type) return;
    // A member's event carries no points and requires nobody, whatever the
    // type says: the type still names it.
    if (canSetRequirements) {
      setPointValue(String(type.point_value));
      setAttendance((previous) =>
        previous.everyone === "not_invited"
          ? previous
          : withEveryone(previous, type.is_mandatory ? "required" : "optional"),
      );
    }
    if (name.trim() === "" || name === typeFilledName) {
      setName(type.name);
      setTypeFilledName(type.name);
    }
  }

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
    if (!canSetRequirements && eventRequiresAnyone(wire)) {
      setShowMore(true);
      toast({
        title: "Only officers who manage events can make one required",
        description: "Set it to optional, or ask one of them to make it.",
        variant: "destructive",
      });
      return;
    }
    if (attendanceInvitesNobody(wire)) {
      setShowMore(true);
      toast({
        title: "Nobody is invited",
        description: "Add a role, or invite everyone.",
        variant: "destructive",
      });
      return;
    }

    // On create the rule steps from the event's start. On an edit it steps
    // from the meeting that is the series' first once the save lands
    // (`repeatEditAnchor`); an untouched draft gives back the stored rule.
    const editRepeatSeries = repeatSeriesAt(new Date(startIso), new Date());
    const repeatResult = repeatLocked
      ? ({ ok: true, rule: null } as const)
      : editRepeatSeries
        ? repeatRuleForEdit(repeat, editRepeatSeries)
        : repeatRuleOf(repeat, new Date(startIso));
    if (!repeatResult.ok) {
      setShowMore(true);
      toast({
        title: "Check the repeat",
        description: repeatResult.error,
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
      point_value: canSetRequirements ? pointValueNumber : 0,
      is_mandatory: wire.is_mandatory,
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
        // A card is broadcast to everyone in the channel, so the API refuses
        // one for an event that keeps anyone out (`EventService.create`).
        const cardKeptOut =
          postToChannelId !== undefined && eventLimitsAudience(wire);
        const card =
          postToChannelId !== undefined && !cardKeptOut
            ? (trackChatCard?.(postToChannelId, payload.name) ?? {
                clientMessageId: randomClientId(),
                failed: () => undefined,
                lost: () => undefined,
              })
            : null;
        let created: { id?: string; card_posted?: boolean } | undefined;
        try {
          created = await createEventMutation.mutateAsync({
            ...payload,
            ...(repeatResult.rule
              ? { recurrence_rule: repeatResult.rule }
              : {}),
            // Only when one is picked, so a plain event still creates
            // against an API that predates types.
            ...(eventTypeId ? { event_type_id: eventTypeId } : {}),
            ...(card
              ? {
                  channel_id: postToChannelId,
                  client_message_id: card.clientMessageId,
                }
              : {}),
            ...(wire.required_role_ids.length > 0
              ? { required_role_ids: wire.required_role_ids }
              : {}),
            ...(othersInvitedForCreate(wire) !== undefined
              ? { others_invited: othersInvitedForCreate(wire) }
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
        } catch (error) {
          card?.failed();
          throw error;
        }
        const cardLost = card !== null && created?.card_posted === false;
        if (cardLost) card.lost();
        toast(createdToast(payload.name, { cardKeptOut, cardLost }));
        if (created?.id && onCreated) {
          // The event exists whatever this does, so it never fails the save.
          try {
            await onCreated(created.id);
          } catch {
            // The caller reports its own failure.
          }
        }
      } else {
        if (!event || !editTarget || parentLoading) return;
        // Only what changed is sent (`eventEditPatch`): a time or location in
        // the patch pushes "Event Updated" to the chapter, so a renamed
        // meeting must not carry them.
        const patch = eventEditPatch(
          {
            name: textOf(event.name) ?? "",
            start_time: editTarget.event.start_time,
            end_time: editTarget.event.end_time,
            location: textOf(event.location),
            description: textOf(event.description),
            notes: textOf(event.notes),
            point_value:
              typeof event.point_value === "number" ? event.point_value : null,
            attendance: attendanceFieldsOf(event),
            event_type_id: textOf(event.event_type_id),
            check_in_zone: event.check_in_zone,
            check_in_zone_name: textOf(event.check_in_zone_name),
          },
          editTarget.seriesRule,
          {
            name: payload.name,
            start: new Date(startIso),
            end: new Date(endIso),
            location: location,
            description: description,
            notes: notes,
            point_value: payload.point_value,
            attendance: wire,
            event_type_id: eventTypeId,
            // Locked while a generated meeting's parent is unread, and then
            // not sent: the series' rule isn't known.
            ...(repeatLocked ? {} : { recurrence_rule: repeatResult.rule }),
            check_in_zone: zone,
            // A leftover name on a zone-less event is inert but misleading.
            check_in_zone_name: zone.length > 0 ? zoneName : "",
          },
        );
        // Nothing changed: nothing to send, and nobody to notify.
        if (isEmptyEventPatch(patch)) {
          onOpenChange(false);
          return;
        }
        // A Repeat change is about the series, so it isn't asked
        // (`saveScopeFor`); anything else on a repeating event is.
        const asked = saveScopeFor(editTarget, patch, new Date());
        let scope: EventEditScope = asked === "ask" ? "instance" : asked;
        if (asked === "ask") {
          const picked = await confirm({
            title: SERIES_SCOPE_COPY.saveTitle,
            description: SERIES_SCOPE_COPY.saveMessage,
            confirmLabel: SERIES_SCOPE_COPY.allUpcoming,
            alternativeLabel: SERIES_SCOPE_COPY.thisEvent,
            tone: "default",
          });
          if (!picked) return;
          scope = picked.alternative ? "instance" : "series";
        }
        const request = saveRequestFor(editTarget, patch, scope);
        let saved: unknown;
        try {
          saved = await updateEventMutation.mutateAsync({
            id: request.id,
            body: { ...request.body, scope: request.scope },
          });
        } catch (error) {
          // Only when the officer picked "All upcoming events": a Repeat
          // change is always the series, so "this event only" isn't an
          // option to point them to.
          if (
            asked === "ask" &&
            request.scope === "series" &&
            statusOf(error) === 400
          ) {
            // Sending it again can't win, so say what to do instead.
            throw new MemberFacingError(SERIES_SCOPE_COPY.seriesRefused);
          }
          throw error;
        }
        const savedId =
          saved && typeof saved === "object" && "id" in saved
            ? String((saved as { id: unknown }).id)
            : null;
        if (leavesAfterSave(request, editTarget, savedId)) onLeftEvent?.();
        toast({
          title: "Event updated",
          description:
            request.scope === "series"
              ? `${payload.name} was updated for every upcoming event.`
              : `${payload.name} was updated successfully.`,
        });
      }
    } catch (error) {
      // A lost answer isn't a refusal: the event may exist (#1717).
      const unconfirmed =
        error instanceof Error && error.message === EVENT_CREATE_UNCONFIRMED;
      toast({
        title: unconfirmed
          ? "Couldn't confirm the event"
          : mode === "create"
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
  const repeatSeries = repeatStart
    ? repeatSeriesAt(repeatStart, new Date())
    : undefined;
  const repeatAnchorStart = repeatSeries
    ? repeatEditAnchor(repeatSeries)
    : repeatStart;
  const moreSummary = [
    ...(canSetRequirements
      ? [
          pointsLabel(Number(pointValue.trim() === "" ? 0 : pointValue)) ??
            "No points",
        ]
      : []),
    describeAttendance(attendance, roleName),
    repeatLocked
      ? "Part of a series"
      : repeatStart
        ? repeatSummary(repeat, repeatAnchorStart ?? repeatStart, repeatSeries)
        : repeat.preset === "NONE"
          ? REPEAT_PRESET_LABELS.NONE
          : "Repeats",
  ].join(" · ");

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      docked={docked}
      backLabel={backLabel}
    >
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
            <EventTypePicker
              value={eventTypeId}
              onPick={handlePickType}
              canManage={canManageTypes && !usingPreviewData}
              disabled={usingPreviewData}
            />

            <div className="grid gap-1">
              <Label htmlFor="event-name">Event name</Label>
              <Input
                id="event-name"
                value={name}
                onChange={(eventValue) => setName(eventValue.target.value)}
                placeholder="Chapter meeting"
              />
            </div>

            {/* Wraps by the panel's own width, not the window's: docked beside chat
                the panel can be 375px wide on a wide screen. A day and a time
                each, the way Google Calendar takes them: the day is typed
                without a year (#3937), the time is the browser's own. */}
            <div className="grid grid-cols-[repeat(auto-fit,minmax(18rem,1fr))] gap-3">
              <ScheduleEnd
                id="event-start"
                label="Starts"
                value={startAt}
                onChange={moveStart}
              />
              <ScheduleEnd
                id="event-end"
                label="Ends"
                value={endAt}
                onChange={setEndAt}
              />
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
                    allowRequired={canSetRequirements}
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

                {repeatLocked ? (
                  <section className="grid gap-1" aria-label="Repeat">
                    <span className="text-sm font-semibold leading-none">
                      Repeat
                    </span>
                    <p className="text-caption text-muted-foreground">
                      {parentLoading
                        ? "Loading the series…"
                        : "Part of a repeating series. Its first meeting couldn't be loaded, so how it repeats can't be changed here."}
                    </p>
                  </section>
                ) : (
                  <RepeatOptions
                    draft={
                      repeatSeries
                        ? repeatEditDraft(repeat, repeatSeries)
                        : repeat
                    }
                    start={repeatAnchorStart}
                    onChange={setRepeat}
                    disabled={usingPreviewData}
                    // An existing series' length was set when it was made;
                    // the line comes back once the officer changes Repeat.
                    showLength={!(mode === "edit" && repeat.pristine)}
                    series={repeatSeries}
                  />
                )}

                {canSetRequirements ? (
                  <div className="grid content-start gap-1">
                    <Label htmlFor="event-point-value">
                      Points for attending
                    </Label>
                    <Input
                      id="event-point-value"
                      type="number"
                      min={0}
                      className="max-w-[14rem]"
                      value={pointValue}
                      onChange={handlePointValueChange}
                    />
                  </div>
                ) : null}

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
            {...gate.controlProps(
              usingPreviewData || isSubmitting || parentLoading,
            )}
          >
            {isSubmitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {submitLabel}
          </Button>
        </PanelFooter>
        {confirmDialog}
      </PanelContent>
    </Panel>
  );
}
