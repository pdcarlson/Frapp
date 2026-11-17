/**
 * Narrowing for the `/v1/events` payloads.
 *
 * These routes had no response schema until #4867, so the shapes were narrowed
 * at the boundary rather than asserted. The SDK now types them
 * (`EventResponseDto`, `EventDetailResponseDto`); moving these readers onto
 * those types is #4952. The narrowing still earns its keep: a row
 * missing `id` would otherwise route to a detail screen that can never load,
 * and a missing `start_time` would render "Invalid Date" to a member.
 *
 * Lives in `lib/` rather than beside a screen because s07 and s18 both need the
 * detail selector, and a route file importing another route file would drag a
 * whole screen component into the scanner's bundle.
 */
import {
  eventSeriesKey,
  selectOwnAttendance,
  type AttendanceRowStatus,
  type DeviceInstant,
} from "@repo/hooks";
import {
  attendanceFieldsOf,
  checkInOpensMinutes,
  readEventAgenda,
  readEventAttachments,
  type EventAgendaItem,
  type EventAttachment,
  type EventAttendanceFields,
} from "@repo/validation";
import { parseInstant } from "@repo/formatting";
import { isRecord, str } from "@/lib/more/narrow";
import { isCurrentOrUpcoming, sortEventsByStart } from "./format";

export interface EventRow {
  id: string;
  name: string;
  location: string | null;
  start_time: string;
  end_time: string;
  point_value: number | null;
  /**
   * Minutes before the start that check-in opens: the event's own, or the
   * default for a row that carries none (`checkInOpensMinutes`).
   */
  check_in_opens_minutes: number;
  /**
   * Who's coming, by role. Whether it is required of the viewer depends on
   * their roles, so a screen asks `useRequiredOfViewer` (`@repo/hooks`).
   */
  attendance: EventAttendanceFields;
  /**
   * The series rule (`WEEKLY` / `BIWEEKLY` / `MONTHLY`) on a series head,
   * `null` on a generated occurrence or a one-off. The list collapses a series
   * by it (`collapseSeries`), and the edit flow reads it (`seriesRuleOf` in
   * `@repo/validation`'s `event-edit.ts`) to tell a series from a one-off.
   */
  recurrence_rule: string | null;
  /**
   * The series head's id on a generated occurrence, `null` on a head or a
   * one-off. The list groups a series by it; the edit flow reads it to fetch
   * the series parent and to ask whether a save covers this occurrence or the
   * series.
   */
  parent_event_id: string | null;
}

export interface EventDetail extends EventRow {
  description: string | null;
  /**
   * The event's notes (`spec/behavior/events.md` § Meeting minutes), editable
   * with `events:update` and read by every member the event invites, so the
   * screen labels them Notes (or Meeting minutes while the meetings module is
   * off), as web's sheet does, never "internal" (#4934).
   */
  notes: string | null;
  /** This meeting's agenda, in order (§ Agenda and attachments). */
  agenda: EventAgendaItem[];
  /** This meeting's links and Chapter Files documents, in order. */
  attachments: EventAttachment[];
  check_in_zone_name: string | null;
  /**
   * Whether the event carries a check-in geofence.
   *
   * Presence only — the polygon itself is never needed on the client, and the
   * server owns the zone test. Shipping the vertices would publish the fence's
   * exact boundary to anyone who asked for the event.
   */
  hasCheckInZone: boolean;
  /**
   * Whether a check-in from this viewer now needs the officer's code
   * (`check_in_needs_code`, #4808): an officer's screen is live and it isn't
   * the viewer's own. False when the read doesn't say.
   */
  checkInNeedsCode: boolean;
  /** The chapter's event type it was made as (#3730), or `null`. */
  event_type_id: string | null;
  /**
   * Who made it, or `null`: the event's excuse receiver
   * (`spec/behavior/events.md` § Excuses), who sees its Excuses list.
   */
  created_by: string | null;
}

function toRow(row: Record<string, unknown>): EventRow | null {
  const id = str(row, "id");
  const name = str(row, "name");
  const startTime = str(row, "start_time");
  const endTime = str(row, "end_time");
  if (!id || !name || !startTime || !endTime) return null;

  return {
    id,
    name,
    location: str(row, "location"),
    start_time: startTime,
    end_time: endTime,
    point_value: typeof row.point_value === "number" ? row.point_value : null,
    check_in_opens_minutes: checkInOpensMinutes(row.check_in_opens_minutes),
    attendance: attendanceFieldsOf(row),
    recurrence_rule: str(row, "recurrence_rule"),
    parent_event_id: str(row, "parent_event_id"),
  };
}

/**
 * Rows for You's Host check-in row and the quick-actions host (s06 reads
 * `selectAllEventRows`): everything a member can still act on — upcoming, plus anything
 * whose check-in window has not closed — soonest first.
 *
 * Past events are dropped deliberately. Attendance history is a reports
 * surface; a list that grows forever buries tonight's meeting under last
 * semester's.
 */
export function selectEventRows(data: unknown, now: Date): EventRow[] {
  return selectAllEventRows(data).filter((row) =>
    isCurrentOrUpcoming(row.start_time, row.end_time, now),
  );
}

/**
 * Every readable event, past ones included, soonest first: what the calendar
 * marks (each occurrence of a series on its own day, #3792), and what a
 * series' cadence is read from, since a series' rule lives on its head row
 * and the head may already have happened.
 */
export function selectAllEventRows(data: unknown): EventRow[] {
  const rows = (Array.isArray(data) ? data.filter(isRecord) : [])
    .map(toRow)
    .filter((row): row is EventRow => !!row);
  return sortEventsByStart(rows);
}

/**
 * The name most of a series' meetings carry (a tie goes to the soonest
 * meeting's), or `null` when none of them is among `rows`. s07 tells an
 * occurrence renamed on its own ("This event only") apart from it.
 */
export function selectSeriesName(
  rows: readonly EventRow[],
  key: string,
): string | null {
  // Map keeps first-insertion order and `rows` come soonest first, so the
  // first name to reach the top count is the soonest meeting's.
  const counts = new Map<string, number>();
  for (const row of rows) {
    if (eventSeriesKey(row) !== key) continue;
    counts.set(row.name, (counts.get(row.name) ?? 0) + 1);
  }
  let best: string | null = null;
  for (const [name, count] of counts) {
    if (best === null || count > (counts.get(best) ?? 0)) best = name;
  }
  return best;
}

/**
 * The other upcoming occurrences of the series `event` belongs to, soonest
 * first, for s07's "Also on" list (#3707). Empty for a one-time event.
 */
export function selectSeriesOccurrences(
  rows: readonly EventRow[],
  event: Pick<EventRow, "id" | "recurrence_rule" | "parent_event_id">,
  now: Date,
): EventRow[] {
  const key = eventSeriesKey(event);
  if (!key) return [];
  return rows.filter((row) => {
    if (row.id === event.id || eventSeriesKey(row) !== key) return false;
    const start = parseInstant(row.start_time);
    return !!start && start.getTime() > now.getTime();
  });
}

export interface MintedCheckInToken {
  qrPayload: string;
  manualCode: string;
  /**
   * When this device asked for the code, on both of its clocks
   * (`useMintCheckInToken`'s `requestedAt`): never later than the mint.
   */
  requestedAt: DeviceInstant;
  /**
   * What the server said was left of the code's window when it minted it.
   * Counted down from `requestedAt` on this device (`elapsedSince`), it ends
   * at or before the real rotation, and it is never compared with the
   * server's clock (its `expiresAt`), which a phone's can be well off.
   */
  rotatesInMs: number;
}

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);

/**
 * The s22 mint result (`useMintCheckInToken`: the response and when it was
 * asked for). Narrowed for the same `never`-inference reason as the event
 * payloads above — and with a second motive: a partially-formed response
 * must not render a QR of `undefined`, which encodes cleanly and scans to
 * nothing. Every field or nothing.
 */
export function selectMintedToken(data: unknown): MintedCheckInToken | null {
  if (!isRecord(data) || !isRecord(data.response)) return null;
  const { response, requestedAt } = data;
  const qrPayload = str(response, "qrPayload");
  const manualCode = str(response, "manualCode");
  const rotatesInMs = response.rotatesInMs;
  if (
    !qrPayload ||
    !manualCode ||
    !isFiniteNumber(rotatesInMs) ||
    !isRecord(requestedAt) ||
    !isFiniteNumber(requestedAt.monotonic) ||
    !isFiniteNumber(requestedAt.wall)
  ) {
    return null;
  }
  return {
    qrPayload,
    manualCode,
    requestedAt: {
      monotonic: requestedAt.monotonic,
      wall: requestedAt.wall,
    },
    rotatesInMs,
  };
}

/** The viewer's own attendance row, as the event page reads it. */
export interface MyAttendance {
  status: AttendanceRowStatus;
  /**
   * When they checked in: set for a PRESENT or LATE row with a time (a LATE
   * row is a check-in, as the roster counts it), `null` for a row an officer
   * marked EXCUSED or ABSENT.
   */
  checkedInAt: Date | null;
}

/**
 * The viewer's row from `useMyAttendance`'s answer
 * (`{ attendance: row | null }`), or `null` when they have none or the answer
 * is unreadable. Parsed by `selectOwnAttendance` in `@repo/hooks`, which web's
 * event sheet reads too; this adds the check-in time as a `Date`.
 */
export function selectMyAttendance(data: unknown): MyAttendance | null {
  const row = selectOwnAttendance(data);
  if (!row) return null;
  const checkedIn = row.status === "PRESENT" || row.status === "LATE";
  return {
    status: row.status,
    checkedInAt: checkedIn ? parseInstant(row.checkInTime) : null,
  };
}

/**
 * An event read without its agenda and attachments (#4934), which Event
 * details saves in place: what the edit sheet is keyed on, so a check-off
 * during the meeting doesn't remount, and close, an open Edit sheet.
 */
export function withoutMeetingLists(data: unknown): unknown {
  if (!isRecord(data)) return data;
  const rest = { ...data };
  delete rest.agenda;
  delete rest.attachments;
  return rest;
}

export function selectEventDetail(data: unknown): EventDetail | null {
  if (!isRecord(data)) return null;
  const row = toRow(data);
  if (!row) return null;

  return {
    ...row,
    description: str(data, "description"),
    notes: str(data, "notes"),
    agenda: readEventAgenda(data.agenda),
    attachments: readEventAttachments(data.attachments),
    check_in_zone_name: str(data, "check_in_zone_name"),
    hasCheckInZone:
      Array.isArray(data.check_in_zone) && data.check_in_zone.length > 0,
    checkInNeedsCode: data.check_in_needs_code === true,
    event_type_id: str(data, "event_type_id"),
    created_by: str(data, "created_by"),
  };
}
