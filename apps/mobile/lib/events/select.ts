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
   * one-off. Read by the calendar export so a recurring meeting exports as a
   * series rather than a single occurrence.
   */
  recurrence_rule: string | null;
  /**
   * Set on a materialized child occurrence, `null` on a series parent or a
   * one-off. Load-bearing for the export: only a parent may describe the
   * series, or a child would re-export the whole series under its own id.
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
  /**
   * When the code rotates, on this device's clock: the request's start plus
   * the server's `rotatesInMs`. Never later than the real rotation, since the
   * request left before the mint, and never compared with the server's clock
   * (its `expiresAt`), which a phone's can be well off.
   */
  rotatesAt: number;
}

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
    typeof rotatesInMs !== "number" ||
    !Number.isFinite(rotatesInMs) ||
    typeof requestedAt !== "number" ||
    !Number.isFinite(requestedAt)
  ) {
    return null;
  }
  return { qrPayload, manualCode, rotatesAt: requestedAt + rotatesInMs };
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
