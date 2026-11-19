"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Plus,
  Trash2,
} from "lucide-react";
import { AttendanceEditor } from "@/components/events/attendance-editor";
import { EventTypeRow } from "@/components/events/event-type-picker";
import { AgendaDraftList } from "@/components/events/event-agenda";
import {
  PropertyRow,
  RowInput,
  RowTextarea,
  RowValueButton,
} from "@/components/events/event-form-rows";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { FOCUS_RING } from "@/components/ui/focus";
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
  CHECK_IN_OPENS_ERROR,
  checkInOpensMinutes,
  DEFAULT_CHECK_IN_OPENS_MINUTES,
  describeCheckIn,
  EVENT_FORM_MEMBER_NOTE,
  EVENT_FORM_PLACEHOLDERS,
  EVENT_FORM_ROW_LABELS,
  parseCheckInOpens,
  othersInvitedForCreate,
  withEveryone,
  describeAttendance,
  emptyAttendanceDraft,
  EVENT_DESCRIPTION_MAX_LENGTH,
  EVENT_LOCATION_MAX_LENGTH,
  EVENT_NAME_MAX_LENGTH,
  EVENT_NOTES_MAX_LENGTH,
  eventLimitsAudience,
  eventRequiresAnyone,
  eventEditPatch,
  isEmptyEventPatch,
  leavesAfterSave,
  noRepeatDraft,
  REPEAT_PRESET_LABELS,
  proposedRepeatDraft,
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
  EVENT_FORM_AGENDA_REPEAT_NOTE,
  agendaWithPending,
  EVENT_LENGTH_CHOICES,
  eventLengthLabel,
  type EventAgendaItem,
  type EventAttendanceDraft,
  type EventEditScope,
  type RepeatDraft,
  type RepeatEditSeries,
} from "@repo/validation";
import { MemberFacingError } from "@repo/hooks/error-copy";
import {
  keepEditsOver as keepFieldEditsOver,
  useKeptFormDraft,
} from "@repo/hooks/kept-drafts";
import { KeptDraftNote } from "@/components/shared/kept-draft-note";
import { useConfirmDialog } from "@/components/shared/confirm-dialog";
import { editTargetOf } from "@/components/events/edit-target";
import { useToast } from "@/lib/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { RepeatOptions } from "@/components/shared/repeat-options";
import {
  Panel,
  PanelBody,
  PanelContent,
  PanelHeader,
  type PanelDocking,
} from "@/components/shared/panel";
import { Input } from "@/components/ui/input";
import { DateField } from "@/components/ui/date-field";
import { TimeField } from "@/components/ui/time-field";
import { Label } from "@/components/ui/label";
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
import { isoToLocalInput } from "@/components/events/local-input";
import { randomClientId, statusOf } from "@repo/api-sdk";
import {
  eventCardOutcomeCopy,
  type EventCardTrack,
} from "@repo/chat-core/dispatch";
import { useMeetingsModuleOn } from "@/components/meetings/event-minutes";

type EventRecord = Record<string, unknown>;

const textOf = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

function localInputToIso(value: string): string {
  // The editor holds a day and a time apart; either may still be empty.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return "";
  const date = parseInstant(value);
  if (!date) return "";
  return date.toISOString();
}

/** `YYYY-MM-DD` plus `days`, read at local noon so a clock change can't skip one. */
function addDays(day: string, days: number): string {
  const at = new Date(`${day}T12:00`);
  if (Number.isNaN(at.getTime())) return day;
  at.setDate(at.getDate() + days);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
}

/** A field set flat into the row: no box until it is hovered or focused. */
const INLINE_FIELD =
  "h-9 border-transparent bg-transparent px-2 shadow-none hover:bg-card-hover focus-visible:bg-surface-1 pointer-coarse:h-11";

/**
 * The When row's value, laid out as Google Calendar's event editor sets it
 * (Paul 2026-11-19: "typing the exact same thing in the second row and just
 * adding an hour is really tedious"): the day once, then the start and the
 * end as times. Each time is typed or picked from a list of quarter hours
 * (`TimeField`, not the browser's own input), and the end's list says how
 * long each choice runs ("9 PM · 1 hr"). Moving the day or the start carries
 * the end with it; an end before the start runs past midnight. A meeting
 * that spans days (a retreat) gets its end's own day from "Ends another
 * day".
 *
 * The values are the `YYYY-MM-DDTHH:MM` the editor has always held, either
 * half empty until it is filled in.
 */
function WhenFields({
  startAt,
  endAt,
  onStart,
  onEnd,
  invalid,
}: {
  startAt: string;
  endAt: string;
  onStart: (next: string) => void;
  onEnd: (next: string) => void;
  invalid: boolean;
}) {
  const [startDay = "", startTime = ""] = startAt.split("T");
  const [endDay = "", endTime = ""] = endAt.split("T");
  // Only past midnight: the next day, at a time before the start.
  const overnight =
    !!startDay &&
    endDay === addDays(startDay, 1) &&
    !!endTime &&
    !!startTime &&
    endTime <= startTime;
  const spansDays =
    !!startDay && !!endDay && endDay !== startDay && !overnight;
  const [askedForEndDay, setAskedForEndDay] = useState(false);
  const showEndDay = askedForEndDay || spansDays;
  const startInstant = parseInstant(localInputToIso(startAt));
  const endInstant = parseInstant(localInputToIso(endAt));
  const lengthMinutes =
    startInstant && endInstant
      ? Math.round((endInstant.getTime() - startInstant.getTime()) / 60_000)
      : null;
  const join = (day: string, time: string) =>
    day || time ? `${day}T${time}` : "";
  const setEndTime = (time: string) => {
    if (showEndDay) {
      onEnd(join(endDay || startDay, time));
      return;
    }
    // On the start's day, or the next one when it runs past midnight.
    const day =
      startDay && time && startTime && time <= startTime
        ? addDays(startDay, 1)
        : startDay;
    onEnd(join(day, time));
  };
  return (
    <div className="grid gap-1">
      <div className="flex min-w-0 flex-wrap items-center gap-x-1 gap-y-1">
        <div className="min-w-[9.5rem] flex-1">
          <DateField
            id="event-start"
            aria-label="Starts, day"
            placeholder="Pick a day"
            lean="ahead"
            value={startDay}
            className={INLINE_FIELD}
            onChange={(day) => onStart(join(day, startTime))}
          />
        </div>
        <div className="w-[5.75rem]">
          <TimeField
            id="event-start-time"
            aria-label="Starts, time"
            placeholder="Start"
            value={startTime}
            className={INLINE_FIELD}
            onChange={(time) => onStart(join(startDay, time))}
          />
        </div>
        <span aria-hidden="true" className="text-muted-foreground">
          –
        </span>
        <div className="w-[5.75rem]">
          <TimeField
            id="event-end-time"
            aria-label="Ends, time"
            placeholder="End"
            value={endTime}
            anchor={startTime || undefined}
            // The end's list runs a day on from the start, each with its
            // length, as Google Calendar's does.
            from={showEndDay ? undefined : startTime || undefined}
            className={cn(INLINE_FIELD, invalid && "text-destructive-text")}
            aria-invalid={invalid || undefined}
            onChange={setEndTime}
          />
        </div>
      </div>
      {/* How long, one click each, as the phone's sheet offers: the end
          moves, the start stays. */}
      {startDay && startTime ? (
        <div
          role="radiogroup"
          aria-label="How long"
          className="flex flex-wrap items-center gap-1 px-1"
        >
          {EVENT_LENGTH_CHOICES.map((minutes) => {
            const held = lengthMinutes === minutes;
            return (
              <button
                key={minutes}
                type="button"
                role="radio"
                aria-checked={held}
                onClick={() => {
                  const from = parseInstant(localInputToIso(startAt));
                  if (!from) return;
                  onEnd(
                    isoToLocalInput(
                      new Date(from.getTime() + minutes * 60_000).toISOString(),
                    ),
                  );
                }}
                className={cn(
                  "h-7 rounded-full border px-2.5 text-caption transition-colors pointer-coarse:h-9",
                  held
                    ? "border-transparent bg-accent-subtle font-semibold text-accent-text"
                    : "border-border text-muted-foreground hover:bg-card-hover hover:text-foreground",
                  FOCUS_RING,
                )}
              >
                {eventLengthLabel(minutes)}
              </button>
            );
          })}
        </div>
      ) : null}
      {showEndDay ? (
        <div className="flex items-center gap-2">
          <span className="w-10 shrink-0 pl-2 text-caption text-muted-foreground">
            Ends
          </span>
          <div className="min-w-[9.5rem] flex-1">
            <DateField
              id="event-end"
              aria-label="Ends, day"
              placeholder="Pick a day"
              lean="ahead"
              value={endDay}
              className={INLINE_FIELD}
              onChange={(day) => onEnd(join(day, endTime))}
            />
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAskedForEndDay(true)}
          className={cn(
            "w-fit rounded-sm px-2 text-caption text-muted-foreground hover:text-foreground hover:underline",
            FOCUS_RING,
          )}
        >
          Ends another day
        </button>
      )}
    </div>
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

/** The rows that open a menu (#5561); one is open at a time. */
type EventFormMenu = "repeat" | "attendance" | "checkIn";

/**
 * What the form keeps when the officer leaves it unsaved (#4593): every field
 * as typed, so it comes back as it was left.
 */
type EventFields = {
  name: string;
  description: string;
  location: string;
  startAt: string;
  endAt: string;
  pointValue: string;
  attendance: EventAttendanceDraft;
  repeat: RepeatDraft;
  notes: string;
  eventTypeId: string | null;
  checkInZone: ZoneVertexDraft[];
  checkInZoneName: string;
  /** Minutes before the start that check-in opens, as typed (#5561). */
  checkInOpens: string;
  /** A new event's agenda (create only; an event's own is edited on it). */
  agenda: EventAgendaItem[];
};
type EventFormDraft = EventFields & {
  typeFilledName: string | null;
  /**
   * An edit's record as the form opened on it. A kept edit is only the fields
   * the officer changed from this: the rest come from the record as it is
   * when the form opens again, so a kept draft never sends back a location
   * someone else has changed since.
   */
  base: EventFields | null;
};

const EVENT_FIELD_KEYS = [
  "name",
  "description",
  "location",
  "startAt",
  "endAt",
  "pointValue",
  "attendance",
  "repeat",
  "notes",
  "eventTypeId",
  "checkInZone",
  "checkInZoneName",
  "checkInOpens",
  "agenda",
] as const satisfies readonly (keyof EventFields)[];

/** A kept edit over the record as it is now: only what the officer changed. */
function keepEditsOver(
  kept: EventFormDraft,
  now: EventFormDraft,
): EventFormDraft {
  const base = kept.base;
  if (!base) return kept;
  const merged = keepFieldEditsOver<EventFields>(
    kept,
    base,
    now,
    EVENT_FIELD_KEYS,
    [["startAt", "endAt"]],
  );
  return {
    ...now,
    ...merged,
    typeFilledName: kept.typeFilledName,
    base: now.base,
  };
}

/** What the form opens on: the record, a template, or a fresh event. */
function openingDraft({
  mode,
  event,
  template,
  initialStartAt,
  initialEndAt,
  initialName,
  initialLocation,
  initialPointValue,
  initialRepeatRule,
}: {
  mode: "create" | "edit";
  event: EventRecord | null;
  template: EventRecord | null | undefined;
  initialStartAt?: string;
  initialEndAt?: string;
  initialName?: string;
  initialLocation?: string;
  initialPointValue?: number;
  initialRepeatRule?: string | null;
}): EventFormDraft {
  const openingRepeat = initialRepeatRule
    ? proposedRepeatDraft(initialRepeatRule)
    : noRepeatDraft();
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const points = (value: unknown) =>
    String(typeof value === "number" ? value : 10);
  if (mode === "edit" && event) {
    const zone = zoneToDrafts(event.check_in_zone);
    const fields: EventFields = {
      name: text(event.name),
      description: text(event.description),
      location: text(event.location),
      startAt: isoToLocalInput(event.start_time),
      endAt: isoToLocalInput(event.end_time),
      pointValue: points(event.point_value),
      attendance: attendanceFromEvent(attendanceFieldsOf(event)),
      // A generated meeting's rule arrives with its parent (the effect
      // after the fill).
      repeat: repeatDraftFromRule(
        editTargetOf(event, null)?.seriesRule ?? null,
      ),
      notes: text(event.notes),
      eventTypeId:
        typeof event.event_type_id === "string" ? event.event_type_id : null,
      checkInZone: zone,
      checkInZoneName: text(event.check_in_zone_name),
      checkInOpens: String(checkInOpensMinutes(event.check_in_opens_minutes)),
      agenda: [],
    };
    return { ...fields, typeFilledName: null, base: fields };
  }
  if (template) {
    const zone = zoneToDrafts(template.check_in_zone);
    return {
      name: text(template.name),
      description: text(template.description),
      location: text(template.location),
      startAt: initialStartAt ?? "",
      endAt: initialEndAt ?? "",
      pointValue: points(template.point_value),
      attendance: attendanceFromEvent(attendanceFieldsOf(template)),
      repeat: openingRepeat,
      notes: text(template.notes),
      eventTypeId:
        typeof template.event_type_id === "string"
          ? template.event_type_id
          : null,
      checkInZone: zone,
      checkInZoneName: text(template.check_in_zone_name),
      checkInOpens: String(
        checkInOpensMinutes(template.check_in_opens_minutes),
      ),
      // Last year's agenda isn't this year's meeting.
      agenda: [],
      typeFilledName: null,
      base: null,
    };
  }
  return {
    name: initialName ?? "",
    description: "",
    location: initialLocation ?? "",
    startAt: initialStartAt ?? "",
    endAt: initialEndAt ?? "",
    pointValue: String(initialPointValue ?? 10),
    attendance: emptyAttendanceDraft(),
    repeat: openingRepeat,
    notes: "",
    eventTypeId: null,
    checkInZone: [],
    checkInZoneName: "",
    checkInOpens: String(DEFAULT_CHECK_IN_OPENS_MINUTES),
    agenda: [],
    typeFilledName: null,
    base: null,
  };
}

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
   * § Docked). Opened from chat's + card or an Ask answer, it docks `"here"`:
   * over the chat column or Ask's card it came from.
   */
  docked?: PanelDocking;
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
   * come from `initialStartAt` / `initialEndAt`, `initialRepeatRule` and the
   * officer. Ignored in edit mode.
   */
  template?: EventRecord | null;
  /**
   * The repeat a fresh create opens with: the series Ask proposed (#5117),
   * following the first meeting as the officer moves it. Ignored in edit
   * mode.
   */
  initialRepeatRule?: string | null;
  /**
   * Keep what is typed when the officer leaves without saving (#4593), under
   * this name (`event-create`, `event-edit:<id>`): going back, Escape or
   * leaving the page keep it, and the form opens on it next time. Cancel and
   * a save drop it. Omitted from chat's `/event`, whose + card keeps its own.
   */
  keptDraft?: string;
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
  initialRepeatRule,
  keptDraft,
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
    if (after && !end) {
      const [startDay = "", startTime = ""] = next.split("T");
      const endTime = endAt.split("T")[1] ?? "";
      if (endTime) {
        // An end time picked before the start was whole keeps that time, on
        // the start's day, or the next when it runs past midnight.
        setEndAt(
          `${endTime <= startTime ? addDays(startDay, 1) : startDay}T${endTime}`,
        );
      } else {
        // No end yet: an hour, as a new event in Google Calendar starts.
        setEndAt(
          isoToLocalInput(
            new Date(after.getTime() + 60 * 60_000).toISOString(),
          ),
        );
      }
    } else if (before && after && end) {
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
  const meetingsOn = useMeetingsModuleOn();
  // The chapter's event type this is made as, or none (#3730). Picking one
  // only fills the form; the event keeps its own points and attendance.
  const [eventTypeId, setEventTypeId] = useState<string | null>(null);
  // The name the last picked type wrote into the name field, so picking a
  // different type replaces it but never a name the officer typed.
  const [typeFilledName, setTypeFilledName] = useState<string | null>(null);
  // The row whose menu is open (#5561): one at a time, and a check on
  // Create that stops on a row opens that row's menu.
  const [menu, setMenu] = useState<EventFormMenu | null>(null);
  // The fields as the form opened, so Discard shows once something changes.
  const [openedFields, setOpenedFields] = useState<EventFields | null>(null);
  const [checkInOpens, setCheckInOpens] = useState(
    String(DEFAULT_CHECK_IN_OPENS_MINUTES),
  );
  const [checkInZone, setCheckInZone] = useState<ZoneVertexDraft[]>([]);
  const [checkInZoneName, setCheckInZoneName] = useState("");
  const [agenda, setAgenda] = useState<EventAgendaItem[]>([]);
  // The Agenda row's add field: a line typed but never entered still goes
  // with Create.
  const [agendaDraft, setAgendaDraft] = useState("");
  // Kept when left unsaved (#4593). The open sections are kept with it but
  // aren't an edit, so only the fields decide whether there is a draft.
  const fields = {
    name,
    description,
    location,
    startAt,
    endAt,
    pointValue,
    attendance,
    repeat,
    notes,
    eventTypeId,
    checkInZone,
    checkInZoneName,
    checkInOpens,
    agenda,
  };
  // An edit's record as the form opened on it (`EventFormDraft.base`).
  const [openedBase, setOpenedBase] = useState<EventFields | null>(null);
  const kept = useKeptFormDraft<EventFormDraft>(
    keptDraft ?? null,
    open,
    { ...fields, typeFilledName, base: openedBase },
    { signature: JSON.stringify(fields) },
  );
  // Set where the form fills on open, for the effect after it in the same
  // pass: `kept.restored` is state and reads the last render's.
  const openedOnDraft = useRef(false);
  // And whether that draft changed Repeat, which a series rule arriving
  // after the fill then leaves alone.
  const keptRepeatEdited = useRef(false);
  // Discard refills the form from scratch.
  const [fillCount, setFillCount] = useState(0);
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
    const target = editTargetOf(event, parentQuery.data ?? null);
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

  const takeKept = kept.take;
  /* eslint-disable react-hooks/set-state-in-effect -- hydrate or reset the form when the dialog opens on a different event */
  useEffect(() => {
    if (!open) return;
    const opened = openingDraft({
      mode,
      event,
      template,
      initialStartAt,
      initialEndAt,
      initialName,
      initialLocation,
      initialPointValue,
      initialRepeatRule,
    });
    const draft = takeKept();
    openedOnDraft.current = draft !== undefined;
    keptRepeatEdited.current =
      !!draft?.base &&
      JSON.stringify(draft.repeat) !== JSON.stringify(draft.base.repeat);
    const fill = draft ? keepEditsOver(draft, opened) : opened;
    setName(fill.name);
    setDescription(fill.description);
    setLocation(fill.location);
    setStartAt(fill.startAt);
    // As every fill does: without it a start move here would be measured
    // from whatever the dialog last held (#4473).
    lastWholeStart.current = parseInstant(localInputToIso(fill.startAt));
    setEndAt(fill.endAt);
    setPointValue(fill.pointValue);
    setAttendance(fill.attendance);
    setRepeat(fill.repeat);
    setNotes(fill.notes);
    setEventTypeId(fill.eventTypeId);
    setTypeFilledName(fill.typeFilledName);
    setCheckInZone(fill.checkInZone);
    setCheckInZoneName(fill.checkInZoneName);
    setCheckInOpens(fill.checkInOpens);
    // A draft kept before the form had an agenda has none.
    setAgenda(fill.agenda ?? []);
    setAgendaDraft("");
    setMenu(null);
    // What the form opened on, so Discard shows only once something is typed.
    setOpenedFields(fill);
    setOpenedBase(opened.base);
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
    initialRepeatRule,
    takeKept,
    fillCount,
  ]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // A generated meeting's rule arrives with its parent, after the form has
  // opened. Repeat is locked until then, so nothing typed is overwritten.
  const parentRule = editTarget?.parent ? editTarget.seriesRule : null;
  const rebaseKept = kept.rebase;
  /* eslint-disable react-hooks/set-state-in-effect -- the parent's rule lands after the form hydrates */
  useEffect(() => {
    if (!open || parentRule === null) return;
    const rule = repeatDraftFromRule(parentRule);
    // The record's Repeat, as the kept edit's base.
    setOpenedBase((base) => (base ? { ...base, repeat: rule } : base));
    // The form filling itself is not a change to discard.
    if (!keptRepeatEdited.current) {
      setOpenedFields((opened) =>
        opened ? { ...opened, repeat: rule } : opened,
      );
    }
    // A kept draft that changed Repeat keeps the officer's own.
    if (!keptRepeatEdited.current) setRepeat(rule);
    // The form filling itself, not an edit to keep.
    if (!openedOnDraft.current) rebaseKept();
    // `fillCount`: Discard refills from the record, rule included.
  }, [open, parentRule, rebaseKept, fillCount]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submitLabel = useMemo(() => {
    if (isSubmitting) {
      return mode === "create" ? "Creating" : "Saving";
    }
    // The phone's header says the same (#5561); the button's name is the
    // whole "Create event" / "Save changes".
    return mode === "create" ? "Create" : "Save";
  }, [isSubmitting, mode]);

  /**
   * Picking a type fills in what it carries: its points, whether everyone
   * must attend (roles already set apart stay set apart), and its name when
   * the name is blank or still the one the last pick wrote. Letting the type
   * go leaves the form as it is.
   */
  function handlePickType(type: EventType | null) {
    // The held type picked again keeps it and what was changed since, as
    // the phone's Type sheet does: it never resets the points or attendance.
    if (type && type.id === eventTypeId) return;
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
    // The first of the When fields that is missing, or the end's time.
    const focusScheduleProblem = () => {
      const [startDay, startTime] = startAt.split("T");
      document
        .getElementById(
          !startDay
            ? "event-start"
            : !startTime
              ? "event-start-time"
              : "event-end-time",
        )
        ?.focus();
    };
    if (!startIso || !endIso) {
      toast({
        title: "Valid schedule required",
        description: "Provide both start and end times.",
        variant: "destructive",
      });
      focusScheduleProblem();
      return;
    }
    if (new Date(endIso).getTime() <= new Date(startIso).getTime()) {
      toast({
        title: "Valid schedule required",
        description: "End must be after start.",
        variant: "destructive",
      });
      focusScheduleProblem();
      return;
    }

    const parsedZone = parseZoneDrafts(checkInZone);
    if (!parsedZone.ok) {
      toast({
        title: "Check-in zone is incomplete",
        description: parsedZone.message,
        variant: "destructive",
      });
      setMenu("checkIn");
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

    const opensMinutes = parseCheckInOpens(checkInOpens);
    if (opensMinutes === null) {
      setMenu("checkIn");
      toast({
        title: "Check when check-in opens",
        description: CHECK_IN_OPENS_ERROR,
        variant: "destructive",
      });
      return;
    }

    const wire = attendanceToWire(attendance);
    if (!canSetRequirements && eventRequiresAnyone(wire)) {
      setMenu("attendance");
      toast({
        title: "Only officers who manage events can make one required",
        description: "Set it to optional, or ask one of them to make it.",
        variant: "destructive",
      });
      return;
    }
    if (attendanceInvitesNobody(wire)) {
      setMenu("attendance");
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
      setMenu("repeat");
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
      check_in_opens_minutes: opensMinutes,
    };
    // Out of the store while the save runs: an officer who leaves and comes
    // back before it lands mustn't be offered the same form to send twice.
    kept.hold();
    try {
      if (mode === "create") {
        const sentAgenda = agendaWithPending(agenda, agendaDraft, randomClientId);
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
            // The first meeting's own (a series' later meetings start with
            // none, `spec/behavior/events.md` § Agenda and attachments).
            ...(sentAgenda.length > 0 ? { agenda: sentAgenda } : {}),
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
        if (!event || !editTarget || parentLoading) {
          kept.release();
          return;
        }
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
            // As the form read it, so an event that never set one doesn't
            // send the default back as a change.
            check_in_opens_minutes: checkInOpensMinutes(
              event.check_in_opens_minutes,
            ),
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
            check_in_opens_minutes: opensMinutes,
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
          kept.drop();
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
          if (!picked) {
            kept.release();
            return;
          }
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
      kept.release();
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

    kept.drop();
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
  const repeatValue = repeatLocked
    ? parentLoading
      ? "Loading the series…"
      : "Part of a series"
    : repeatStart
      ? repeatSummary(repeat, repeatAnchorStart ?? repeatStart, repeatSeries)
      : repeat.preset === "NONE"
        ? REPEAT_PRESET_LABELS.NONE
        : "Repeats";
  const startIso = localInputToIso(startAt);
  const endIso = localInputToIso(endAt);
  const endsBeforeStart =
    !!startIso &&
    !!endIso &&
    new Date(endIso).getTime() <= new Date(startIso).getTime();
  const fieldSignature = (value: EventFields | null) =>
    value ? JSON.stringify(EVENT_FIELD_KEYS.map((key) => value[key])) : "";
  const touched =
    fieldSignature(fields) !== fieldSignature(openedFields) ||
    agendaDraft.trim() !== "";
  const menuProps = (row: EventFormMenu) => ({
    open: menu === row,
    onOpenChange: (next: boolean) => setMenu(next ? row : null),
  });
  const notesLabel = meetingsOn ? "Notes" : "Meeting minutes";
  const checkInValue = describeCheckIn(
    parseCheckInOpens(checkInOpens),
    checkInZone.some((row) => row.lat.trim() !== "" || row.lng.trim() !== ""),
  );

  return (
    <Panel
      open={open}
      onOpenChange={onOpenChange}
      docked={docked}
      backLabel={backLabel}
    >
      {/*
        A panel, not a dialog (`components.md` § Surface size): this form runs
        to a role list and a polygon of any length. It opens at the event
        panel's own width, so Edit event reads as that panel turning into its
        editor.

        No description: the one this had restated the form's own fields.
        `aria-describedby={undefined}` tells Radix the omission is deliberate.
      */}
      <PanelContent
        onCloseAutoFocus={onCloseAutoFocus}
        aria-describedby={undefined}
        onKeyDown={(keyEvent) => {
          // Ctrl/Cmd+Enter creates from anywhere in the form, as Linear's
          // create does. Not from a menu or dialog opened over it (React
          // carries their keys here through the portal): the Type search
          // takes Enter as a pick, and the series question as its answer.
          const target = keyEvent.target;
          if (
            keyEvent.defaultPrevented ||
            !(target instanceof Node) ||
            !keyEvent.currentTarget.contains(target)
          ) {
            return;
          }
          if (
            keyEvent.key === "Enter" &&
            (keyEvent.metaKey || keyEvent.ctrlKey) &&
            gate.allowed &&
            !usingPreviewData &&
            !isSubmitting &&
            !parentLoading
          ) {
            keyEvent.preventDefault();
            void handleSubmit();
          }
        }}
      >
        {/* Create sits in the header, opposite the way back, as Apple
            Calendar's new event sheet puts Add (#5561): the action stays by
            the fields however short the form is. Going back keeps what was
            typed (#4593); Discard is the one way to drop it, shown once
            something is typed, and Kept-draft's own line offers it when the
            form opened on one. */}
        <PanelHeader
          actions={
            <div className="flex items-center gap-1">
              {touched && !kept.restored ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    kept.drop();
                    onOpenChange(false);
                  }}
                >
                  Discard
                </Button>
              ) : null}
              <Button
                size="sm"
                aria-label={mode === "create" ? "Create event" : "Save changes"}
                onClick={handleSubmit}
                {...gate.controlProps(
                  usingPreviewData || isSubmitting || parentLoading,
                )}
                className="min-w-[5.5rem]"
              >
                {submitLabel}
              </Button>
            </div>
          }
        >
          {mode === "create" ? "New event" : "Edit event"}
        </PanelHeader>

        <PanelBody className="gap-3">
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

          {/* The name first and largest, borderless until it holds the
              caret, as Linear's and Notion's titles are. */}
          <input
            id="event-name"
            aria-label="Event name"
            maxLength={EVENT_NAME_MAX_LENGTH}
            value={name}
            onChange={(eventValue) => setName(eventValue.target.value)}
            placeholder={EVENT_FORM_PLACEHOLDERS.name}
            autoFocus={mode === "create"}
            className={cn(
              "-mx-2 h-11 rounded-md bg-transparent px-2 text-xl font-semibold text-foreground caret-primary placeholder:text-muted-foreground",
              "hover:bg-card-hover focus:bg-surface-1",
              FOCUS_RING,
            )}
          />

          {/*
            One row per setting, each a click from changing (#5561, Paul
            2026-11-19): points, who must come and repeat show what they are
            at rest instead of waiting behind More options. The phone's sheet
            draws the same rows in the same order (`EVENT_FORM_ROWS`).
          */}
          <div className="grid gap-0.5">
            <EventTypeRow
              value={eventTypeId}
              onPick={handlePickType}
              canManage={canManageTypes && !usingPreviewData}
              showSets={canSetRequirements}
              disabled={usingPreviewData}
            />

            <PropertyRow
              glyph="when"
              label={EVENT_FORM_ROW_LABELS.when}
              align="start"
            >
              <WhenFields
                startAt={startAt}
                endAt={endAt}
                onStart={moveStart}
                onEnd={setEndAt}
                invalid={endsBeforeStart}
              />
              {endsBeforeStart ? (
                <p className="px-2 text-caption text-destructive-text">
                  Ends before it starts.
                </p>
              ) : null}
            </PropertyRow>

            <PropertyRow glyph="repeat" label={EVENT_FORM_ROW_LABELS.repeat}>
              <Popover {...menuProps("repeat")}>
                <PopoverTrigger asChild>
                  <RowValueButton
                    aria-label={`Repeat: ${repeatValue}`}
                    empty={!repeatLocked && repeat.preset === "NONE"}
                  >
                    {repeatValue}
                  </RowValueButton>
                </PopoverTrigger>
                <PopoverContent align="start" className="w-[24rem]">
                  {repeatLocked ? (
                    <p className="text-caption text-muted-foreground">
                      {parentLoading
                        ? "Loading the series…"
                        : "Part of a repeating series. Its first meeting couldn't be loaded, so how it repeats can't be changed here."}
                    </p>
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
                </PopoverContent>
              </Popover>
            </PropertyRow>

            <PropertyRow
              glyph="location"
              label={EVENT_FORM_ROW_LABELS.location}
              labelFor="event-location"
            >
              <RowInput
                id="event-location"
                maxLength={EVENT_LOCATION_MAX_LENGTH}
                value={location}
                onChange={(eventValue) => setLocation(eventValue.target.value)}
                placeholder={EVENT_FORM_PLACEHOLDERS.location}
              />
            </PropertyRow>

            <PropertyRow
              glyph="attendance"
              label={EVENT_FORM_ROW_LABELS.attendance}
            >
              <Popover {...menuProps("attendance")}>
                <PopoverTrigger asChild>
                  <RowValueButton
                    aria-label={`Who's coming: ${describeAttendance(attendance, roleName)}`}
                  >
                    {describeAttendance(attendance, roleName)}
                  </RowValueButton>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="max-h-[min(32rem,70vh)] w-[26rem] overflow-y-auto"
                >
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
                </PopoverContent>
              </Popover>
            </PropertyRow>

            {canSetRequirements ? (
              <PropertyRow
                glyph="points"
                label={EVENT_FORM_ROW_LABELS.points}
                labelFor="event-point-value"
              >
                <div className="flex items-center gap-1">
                  <RowInput
                    id="event-point-value"
                    aria-label="Points for attending"
                    type="number"
                    min={0}
                    inputMode="numeric"
                    className="w-20 tabular-nums"
                    value={pointValue}
                    onChange={handlePointValueChange}
                  />
                  <span className="text-sm text-muted-foreground">
                    {pointValue.trim() === "1" ? "point" : "points"}
                  </span>
                </div>
              </PropertyRow>
            ) : null}

            {/*
              The agenda while the event is made (Paul 2026-11-19: "where is
              the ability to add agenda items"). Only on create: an event's
              agenda is edited on its page, checked off there during the
              meeting, so an edit here would race that one.
            */}
            {mode === "create" ? (
              <PropertyRow
                glyph="agenda"
                label={EVENT_FORM_ROW_LABELS.agenda}
                align="start"
              >
                <AgendaDraftList
                  agenda={agenda}
                  onChange={setAgenda}
                  draft={agendaDraft}
                  onDraftChange={setAgendaDraft}
                  disabled={usingPreviewData}
                />
                {repeat.preset !== "NONE" && agenda.length > 0 ? (
                  <p className="px-2 text-caption text-muted-foreground">
                    {EVENT_FORM_AGENDA_REPEAT_NOTE}
                  </p>
                ) : null}
              </PropertyRow>
            ) : null}

            <PropertyRow
              glyph="description"
              label={EVENT_FORM_ROW_LABELS.description}
              labelFor="event-description"
              align="start"
            >
              <RowTextarea
                id="event-description"
                maxLength={EVENT_DESCRIPTION_MAX_LENGTH}
                value={description}
                onChange={(eventValue) =>
                  setDescription(eventValue.target.value)
                }
                placeholder={EVENT_FORM_PLACEHOLDERS.description}
              />
            </PropertyRow>

            {/* Labeled as the sheet labels them: Notes while minutes are
                their own record (#4934). On create too, as the phone's
                sheet has it (#5561). */}
            <PropertyRow
              glyph="notes"
              label={notesLabel}
              labelFor="event-meeting-minutes"
              align="start"
            >
              <RowTextarea
                id="event-meeting-minutes"
                maxLength={EVENT_NOTES_MAX_LENGTH}
                value={notes}
                onChange={(eventValue) => setNotes(eventValue.target.value)}
                placeholder={EVENT_FORM_PLACEHOLDERS.notes}
              />
            </PropertyRow>

            <PropertyRow glyph="checkIn" label={EVENT_FORM_ROW_LABELS.checkIn}>
              <Popover {...menuProps("checkIn")}>
                <PopoverTrigger asChild>
                  <RowValueButton
                    aria-label={`Check-in: ${checkInValue}`}
                    invalid={parseCheckInOpens(checkInOpens) === null}
                  >
                    {checkInValue}
                  </RowValueButton>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="grid max-h-[min(36rem,75vh)] w-[26rem] gap-4 overflow-y-auto"
                >
                  {/* #3703: members arrive early, so check-in opens ahead of
                      the start; 10 minutes unless the officer says. The
                      phone's sheet sets the same field. */}
                  <div className="grid gap-1">
                    <Label htmlFor="event-check-in-opens">
                      Opens how many minutes early
                    </Label>
                    <Input
                      id="event-check-in-opens"
                      inputMode="numeric"
                      className="max-w-[8rem]"
                      value={checkInOpens}
                      disabled={usingPreviewData}
                      onChange={(eventValue) => {
                        const next = guardIntDraft(eventValue.target.value);
                        if (next !== undefined) setCheckInOpens(next);
                      }}
                      aria-invalid={parseCheckInOpens(checkInOpens) === null}
                    />
                  </div>
                  <div className="grid gap-2">
                    <span className="text-sm font-semibold">Check-in zone</span>
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
                </PopoverContent>
              </Popover>
            </PropertyRow>
          </div>

          {canSetRequirements ? null : (
            <p className="text-caption text-muted-foreground">
              {EVENT_FORM_MEMBER_NOTE}
            </p>
          )}

          <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 text-caption text-muted-foreground">
            {kept.restored ? (
              <KeptDraftNote
                onDiscard={() => {
                  kept.discard();
                  setFillCount((count) => count + 1);
                }}
              />
            ) : (
              <span>Going back keeps your draft.</span>
            )}
            <span>
              <kbd className="font-sans">Ctrl</kbd> +{" "}
              <kbd className="font-sans">Enter</kbd> to{" "}
              {mode === "create" ? "create" : "save"}
            </span>
          </div>
        </PanelBody>
        {confirmDialog}
      </PanelContent>
    </Panel>
  );
}
