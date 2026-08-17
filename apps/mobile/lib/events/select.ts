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
import { isCurrentOrUpcoming, sortEventsByStart } from "./format";

export interface EventRow {
  id: string;
  name: string;
  location: string | null;
  start_time: string;
  end_time: string;
  point_value: number | null;
  is_mandatory: boolean;
}

export interface EventDetail extends EventRow {
  description: string | null;
  check_in_zone_name: string | null;
  /**
   * Whether the event carries a check-in geofence.
   *
   * Presence only — the polygon itself is never needed on the client, and the
   * server owns the zone test. Shipping the vertices would publish the fence's
   * exact boundary to anyone who asked for the event.
   */
  hasCheckInZone: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object";
}

function str(row: Record<string, unknown>, key: string): string | null {
  const raw = row[key];
  return typeof raw === "string" && raw.length > 0 ? raw : null;
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
    is_mandatory: row.is_mandatory === true,
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
  expiresAt: string;
}

/**
 * The s22 mint response. Narrowed for the same `never`-inference reason as the
 * event payloads above — and with a second motive: a partially-formed response
 * must not render a QR of `undefined`, which encodes cleanly and scans to
 * nothing. All three fields or nothing.
 */
export function selectMintedToken(data: unknown): MintedCheckInToken | null {
  if (!isRecord(data)) return null;
  const qrPayload = str(data, "qrPayload");
  const manualCode = str(data, "manualCode");
  const expiresAt = str(data, "expiresAt");
  if (!qrPayload || !manualCode || !expiresAt) return null;
  return { qrPayload, manualCode, expiresAt };
}

/**
 * Count members marked present on the attendance roster (s22's "23 checked in").
 *
 * `PRESENT` and `LATE` both count, matching `countCheckedIn` in the web event
 * card — a member marked LATE did attend, and showing them as absent on the
 * host screen would contradict the roster the same officer can open.
 */
export function countCheckedIn(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  return data.filter((row) => {
    if (!isRecord(row)) return false;
    return row.status === "PRESENT" || row.status === "LATE";
  }).length;
}

export function selectEventDetail(data: unknown): EventDetail | null {
  if (!isRecord(data)) return null;
  const row = toRow(data);
  if (!row) return null;

  return {
    ...row,
    description: str(data, "description"),
    check_in_zone_name: str(data, "check_in_zone_name"),
    hasCheckInZone:
      Array.isArray(data.check_in_zone) && data.check_in_zone.length > 0,
  };
}
