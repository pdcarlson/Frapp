/**
 * Narrowing for the `/v1/events` payloads.
 *
 * The generated SDK types for these routes infer as `never` — the same gap
 * `components/chat/up-next-strip.tsx` documents — so the shapes are narrowed at
 * the boundary rather than asserted. That is not just type hygiene here: a row
 * missing `id` would otherwise route to a detail screen that can never load,
 * and a missing `start_time` would render "Invalid Date" to a member.
 *
 * Lives in `lib/` rather than beside a screen because s07 and s18 both need the
 * detail selector, and a route file importing another route file would drag a
 * whole screen component into the scanner's bundle.
 */
import type { DeviceInstant } from "@repo/hooks";
import {
  attendanceFieldsOf,
  checkInOpensMinutes,
  type EventAttendanceFields,
} from "@repo/validation";
import { dayDelta, parseInstant } from "@repo/formatting";
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
   * their roles, so a screen asks `useRequiredOfViewer` (`viewer-roles.ts`).
   */
  attendance: EventAttendanceFields;
}

export interface EventDetail extends EventRow {
  description: string | null;
  /**
   * Meeting minutes (`spec/behavior/events.md` § Meeting minutes) — editable
   * by admins with `events:update` after the event. Rendered here on the same
   * terms as `description`: whatever `GET /v1/events/:id` returns, since
   * neither field is filtered server-side by the event's `required_role_ids`
   * targeting — see #1463. Web's `event-detail-sheet.tsx` labels the section
   * "Internal notes"; mirrored here rather than inventing a second label.
   */
  notes: string | null;
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
   * The series rule (`WEEKLY` / `BIWEEKLY` / `MONTHLY`), or `null` for a
   * one-off. The edit flow reads it (`seriesRuleOf` in `edit-event.ts`) to
   * tell a series from a one-off and to know the series' rule.
   */
  recurrence_rule: string | null;
  /**
   * Set on a materialized child occurrence, `null` on a series parent or a
   * one-off. The edit flow reads it to fetch the series parent and to ask
   * whether a save covers this occurrence or the series.
   */
  parent_event_id: string | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function str(row: Record<string, unknown>, key: string): string | null {
  const raw = row[key];
  // Trim-checked, not just length-checked — matching `lib/more/narrow.ts`'s
  // `str()`. A whitespace-only value (e.g. notes edited down to nothing) must
  // read as absent, or a section renders with a label and an invisible body.
  return typeof raw === "string" && raw.trim().length > 0 ? raw : null;
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
  };
}

/**
 * Rows for s06: everything a member can still act on — upcoming, plus anything
 * whose check-in window has not closed — soonest first.
 *
 * Past events are dropped deliberately. Attendance history is a reports
 * surface; a list that grows forever buries tonight's meeting under last
 * semester's.
 */
export function selectEventRows(data: unknown, now: Date): EventRow[] {
  const rows = (Array.isArray(data) ? data.filter(isRecord) : [])
    .map(toRow)
    .filter((row): row is EventRow => !!row)
    .filter((row) => isCurrentOrUpcoming(row.start_time, row.end_time, now));

  return sortEventsByStart(rows);
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

/**
 * When the viewer checked in, from `useMyAttendance`'s answer
 * (`{ attendance: row | null }`), or `null` when they haven't: no row, a row
 * without a check-in time (an officer's ABSENT or EXCUSED), or anything
 * unreadable. A LATE row with a time is a check-in, as the roster counts it.
 */
export function selectMyCheckIn(data: unknown): Date | null {
  if (!isRecord(data) || !isRecord(data.attendance)) return null;
  const { status, check_in_time } = data.attendance;
  if (status !== "PRESENT" && status !== "LATE") return null;
  return parseInstant(check_in_time);
}

export function selectEventDetail(data: unknown): EventDetail | null {
  if (!isRecord(data)) return null;
  const row = toRow(data);
  if (!row) return null;

  return {
    ...row,
    description: str(data, "description"),
    notes: str(data, "notes"),
    check_in_zone_name: str(data, "check_in_zone_name"),
    hasCheckInZone:
      Array.isArray(data.check_in_zone) && data.check_in_zone.length > 0,
    recurrence_rule: str(data, "recurrence_rule"),
    parent_event_id: str(data, "parent_event_id"),
  };
}

/**
 * Splits s06's rows after the lead card into "This week" and "Later".
 *
 * The same calendar-day rule as the row's own date block
 * (`formatEventDateBlock`: weekday under seven days, month after) and as the
 * Tasks board's `THIS_WEEK_DAYS`, so a row that reads "WED" never lands under
 * Later and a row that reads "NOV" never lands under This week. An unparseable
 * `start_time` goes to Later rather than throwing.
 */
export function groupByWeek(
  events: EventRow[],
  now: Date,
): { thisWeek: EventRow[]; later: EventRow[] } {
  const thisWeek: EventRow[] = [];
  const later: EventRow[] = [];
  for (const event of events) {
    const start = parseInstant(event.start_time);
    (start && dayDelta(now, start) < 7 ? thisWeek : later).push(event);
  }
  return { thisWeek, later };
}
