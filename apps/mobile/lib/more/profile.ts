/**
 * Narrowing and derivation for s15 (Profile).
 *
 * The drawn screen carries three stat cards — points, service hours, and "96%
 * attendance". Only the first two are built, because no attendance *rate* is
 * readable by a member: `POST /v1/reports/attendance` is a chapter-wide report
 * generator behind `reports:export` (which members do not hold) whose rows carry
 * `member_name` and no `user_id`, it takes no per-member filter, and there is no
 * denominator of events a member owed. `spec/ui/mobile/screens.md` also records
 * that reports stay web-only. Two true numbers beat three with one invented.
 */
import { initialsFor, isRecord, num, records, str } from "./narrow";

export interface ViewerProfile {
  displayName: string | null;
  initials: string;
  email: string | null;
  graduationYear: number | null;
  currentCity: string | null;
  currentCompany: string | null;
  bio: string | null;
}

/** `GET /v1/users/me`, narrowed. Returns `null` before the first payload. */
export function selectViewerProfile(data: unknown): ViewerProfile | null {
  if (!isRecord(data)) return null;
  const displayName = str(data, "display_name");
  return {
    displayName,
    initials: initialsFor(displayName),
    email: str(data, "email"),
    graduationYear: num(data, "graduation_year"),
    currentCity: str(data, "current_city"),
    currentCompany: str(data, "current_company"),
    bio: str(data, "bio"),
  };
}

/**
 * The member's point balance from `GET /v1/points/me`, which returns
 * `{ balance, transactions }`.
 *
 * `null` rather than `0` when absent: a member with no transactions genuinely
 * has a balance of zero, and drawing that same zero for "not loaded" would
 * state a fact the screen does not know yet.
 */
export function selectPointsBalance(data: unknown): number | null {
  return isRecord(data) ? num(data, "balance") : null;
}

/**
 * Approved service hours, summed from the member's own entries.
 *
 * Approved only, matching how the chapter leaderboard counts them
 * (`get_service_leaderboard` covers APPROVED rows) — pending time is not yet
 * credited, and showing it here would overstate what the member has banked.
 * Minutes are the stored unit; hours are derived at the edge so no precision is
 * lost server-side.
 *
 * `null` when there is no payload, for the same reason `selectPointsBalance`
 * returns it: a member with no entries really has zero minutes, and drawing
 * that same zero while the request is still in flight — or after it failed —
 * states a fact the screen does not have.
 */
export function sumApprovedServiceMinutes(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  return records(data)
    .filter((row) => str(row, "status") === "APPROVED")
    .reduce((total, row) => total + (num(row, "duration_minutes") ?? 0), 0);
}

/** Minutes to a one-decimal hour string, e.g. `1110` → `"18.5"`. */
export function formatHours(minutes: number): string {
  const hours = minutes / 60;
  // A whole number reads better without the decimal; anything else keeps one.
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** `2027` → `"'27"`, the form the reference draws. */
export function formatGraduationYear(year: number | null): string | null {
  if (year === null) return null;
  return `'${String(year).slice(-2)}`;
}
