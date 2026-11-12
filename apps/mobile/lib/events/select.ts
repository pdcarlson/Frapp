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
import {
  collapseSeries,
  eventSeriesKey,
  selectOwnAttendance,
  seriesCadenceLabel,
  seriesHeadOf,
  splitByHorizon,
  type AttendanceRowStatus,
  type DeviceInstant,
} from "@repo/hooks";
import {
  attendanceFieldsOf,
  checkInOpensMinutes,
  type EventAttendanceFields,
} from "@repo/validation";
import { formatDayHeading, localIsoDate, parseInstant } from "@repo/formatting";
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
  /** The chapter's event type it was made as (#3730), or `null`. */
  event_type_id: string | null;
  /**
   * Who made it, or `null`: the event's excuse receiver
   * (`spec/behavior/events.md` § Excuses), who sees its Excuses list.
   */
  created_by: string | null;
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
    recurrence_rule: str(row, "recurrence_rule"),
    parent_event_id: str(row, "parent_event_id"),
  };
}

/**
 * Rows for More's Host check-in row and the quick-actions host (s06 reads
 * `selectAllEventRows` and `selectEventList`): everything a member can still act on — upcoming, plus anything
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
 * marks (each occurrence of a series on its own day, #3792), and what the
 * list collapses series from, since a series' rule lives on its head row and
 * the head may already have happened.
 */
export function selectAllEventRows(data: unknown): EventRow[] {
  const rows = (Array.isArray(data) ? data.filter(isRecord) : [])
    .map(toRow)
    .filter((row): row is EventRow => !!row);
  return sortEventsByStart(rows);
}

/** One row of the s06 list: an event and, for a series, how often it meets. */
export interface EventListEntry {
  event: EventRow;
  /** "Every Sunday" on a series' row, `null` on a one-time event. */
  cadence: string | null;
}

/** The rows of one day under its written-out heading ("Tomorrow"). */
export interface EventDayGroup {
  /** The local calendar day, `YYYY-MM-DD`: a stable key. */
  day: string;
  heading: string;
  entries: EventListEntry[];
}

function groupByDay(entries: EventListEntry[], now: Date): EventDayGroup[] {
  const groups: EventDayGroup[] = [];
  for (const entry of entries) {
    const start = parseInstant(entry.event.start_time);
    if (!start) continue;
    const day = localIsoDate(start);
    const last = groups[groups.length - 1];
    if (last?.day === day) {
      last.entries.push(entry);
    } else {
      groups.push({
        day,
        heading: formatDayHeading(entry.event.start_time, now) ?? day,
        entries: [entry],
      });
    }
  }
  return groups;
}

/**
 * How often `event`'s series meets ("Every Sunday"), or `null` for a one-time
 * event or a series whose head isn't among `rows`. The rule is the head's;
 * the day is the one most of the series' meetings share (`seriesCadenceLabel`,
 * as web's list reads it), never `event`'s own: an occurrence the API clamped
 * to the 30th, or one an officer moved to a Monday, belongs to a series that
 * still meets on the 31st or on Sundays.
 */
export function selectSeriesCadence(
  rows: readonly EventRow[],
  event: Pick<
    EventRow,
    "id" | "start_time" | "recurrence_rule" | "parent_event_id"
  >,
): string | null {
  const key = eventSeriesKey(event);
  if (!key) return null;
  const rule =
    key === event.id
      ? event.recurrence_rule
      : seriesHeadOf(key, rows)?.recurrence_rule;
  if (!rule) return null;
  return seriesCadenceLabel(
    rule,
    event.start_time,
    rows
      .filter((row) => eventSeriesKey(row) === key)
      .map((row) => row.start_time),
  );
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
 * s06's list (#3707): what a member can still act on, a repeating series once
 * as its next occurrence with "Every Sunday" beside it, grouped under
 * written-out day headings, split at the two-week horizon into `soon` and
 * `later`. Grouping and the horizon are `@repo/hooks`' `event-series.ts`,
 * which web's list reads too.
 *
 * A series meeting that has started and is still open for check-in is the
 * series' row while it runs: it carries the cadence, and next week's
 * occurrence stays off the list until it ends, so the series is never drawn
 * twice.
 *
 * Takes {@link selectAllEventRows}' rows, parsed once per payload, since this
 * reruns on every clock tick.
 */
export function selectEventList(
  rows: readonly EventRow[],
  now: Date,
): { soon: EventDayGroup[]; later: EventDayGroup[] } {
  const nowMs = now.getTime();
  const visible = collapseSeries(rows, nowMs).filter(({ event }) =>
    isCurrentOrUpcoming(event.start_time, event.end_time, now),
  );

  // Series with a meeting under way: that meeting is the series' row.
  const running = new Set<string>();
  for (const { event, series } of visible) {
    const key = eventSeriesKey(event);
    if (key && series === null) running.add(key);
  }

  const shown = visible.filter(({ event, series }) => {
    const key = eventSeriesKey(event);
    return !(key && series !== null && running.has(key));
  });

  const withCadence = (entries: typeof shown): EventListEntry[] =>
    entries.map(({ event }) => ({
      event,
      cadence: selectSeriesCadence(rows, event),
    }));
  const { soon, later } = splitByHorizon(shown, nowMs);
  return {
    soon: groupByDay(withCadence(soon), now),
    later: groupByDay(withCadence(later), now),
  };
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
    event_type_id: str(data, "event_type_id"),
    created_by: str(data, "created_by"),
  };
}
