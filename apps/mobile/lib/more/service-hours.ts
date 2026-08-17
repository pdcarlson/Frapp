/**
 * Narrowing and derivation for the service-hours screen and its s20 log sheet,
 * over `GET /v1/service-entries`.
 *
 * The endpoint pins a non-admin's read to their own id server-side, so what
 * comes back here is already the member's own history — no client-side filter
 * makes that true, and none should pretend to.
 */
import { metaLine, num, records, str } from "./narrow";
import { formatHours } from "./profile";

export type ServiceEntryStatus = "PENDING" | "APPROVED" | "REJECTED";

export interface ServiceEntryRow {
  id: string;
  description: string;
  status: ServiceEntryStatus;
  durationMinutes: number;
  /** e.g. `"2h 30m · Aug 12"`. */
  meta: string | null;
  date: string;
}

export interface ServiceSummary {
  approvedMinutes: number;
  /** Approved hours, one decimal — the number the summary card leads with. */
  approvedHours: string;
  pendingCount: number;
}

const STATUSES: ReadonlySet<string> = new Set([
  "PENDING",
  "APPROVED",
  "REJECTED",
]);

/** `150` → `"2h 30m"`, `45` → `"45m"`, `120` → `"2h"`. */
export function formatDuration(minutes: number): string {
  const whole = Math.max(0, Math.round(minutes));
  const hours = Math.floor(whole / 60);
  const rest = whole % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${rest}m`;
}

/** `"2026-08-12"` → `"Aug 12"`. Falls back to the raw value if unparseable. */
function formatDate(value: string): string {
  // Parsed as UTC noon, not midnight: a bare `YYYY-MM-DD` is UTC midnight, which
  // renders as the previous day for anyone west of Greenwich — and a service
  // entry dated the 12th must not display as the 11th.
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function toRow(row: Record<string, unknown>): ServiceEntryRow | null {
  const id = str(row, "id");
  const rawStatus = str(row, "status");
  const date = str(row, "date");
  if (!id || !rawStatus || !STATUSES.has(rawStatus) || !date) return null;

  const durationMinutes = num(row, "duration_minutes") ?? 0;
  return {
    id,
    description: str(row, "description") ?? "Service entry",
    status: rawStatus as ServiceEntryStatus,
    durationMinutes,
    meta: metaLine([formatDuration(durationMinutes), formatDate(date)]),
    date,
  };
}

/** The member's entries, newest first. */
export function selectServiceEntryRows(data: unknown): ServiceEntryRow[] {
  return records(data)
    .map(toRow)
    .filter((row): row is ServiceEntryRow => !!row)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * The summary card's numbers.
 *
 * Approved only, matching how the chapter leaderboard counts: pending time is
 * not yet credited, so banking it here would overstate what the member has.
 * Pending is surfaced as a count instead, which is what they can act on.
 */
export function summarizeServiceEntries(rows: ServiceEntryRow[]): ServiceSummary {
  const approvedMinutes = rows
    .filter((row) => row.status === "APPROVED")
    .reduce((total, row) => total + row.durationMinutes, 0);

  return {
    approvedMinutes,
    approvedHours: formatHours(approvedMinutes),
    pendingCount: rows.filter((row) => row.status === "PENDING").length,
  };
}

/**
 * Parse an `H:MM` or decimal-hours duration into whole minutes for the s20
 * sheet, or `null` when it is not a duration.
 *
 * Both forms are accepted because members write both — "1:30" and "1.5" are the
 * same shift — and rejecting one of them would be a validation error over
 * nothing. Zero is rejected: a zero-minute entry is not a submission.
 */
export function parseDurationInput(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;

  const clock = /^(\d{1,3}):([0-5]\d)$/.exec(trimmed);
  if (clock) {
    const minutes = Number(clock[1]) * 60 + Number(clock[2]);
    return minutes > 0 ? minutes : null;
  }

  const decimal = /^\d{1,3}(\.\d{1,2})?$/.exec(trimmed);
  if (decimal) {
    const minutes = Math.round(Number(trimmed) * 60);
    return minutes > 0 ? minutes : null;
  }

  return null;
}

/** Today as `YYYY-MM-DD` in the device's own zone — what the API's `date` wants. */
export function todayIsoDate(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
