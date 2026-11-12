/**
 * The two stat cards on the viewer's own Profile, points and service hours,
 * which both apps draw (s15; web since #4137). One copy of the reads and the
 * arithmetic, so the web card and the phone card can't disagree on a number.
 *
 * The drawn screen carries a third card, "96% attendance". It is not built on
 * either app because no attendance *rate* is readable by a member:
 * `POST /v1/reports/attendance` is a chapter-wide report behind
 * `reports:export`, its rows carry no `user_id`, and there is no denominator of
 * events a member owed. Two true numbers beat three with one invented.
 */
import { useActiveChapterId } from "./use-frapp-client";
import { useMyPoints } from "./use-points";
import { useServiceEntries } from "./use-service-entries";
import { useViewerUserId } from "./use-user";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The viewer's points balance from `GET /v1/points/me`.
 *
 * `null` rather than `0` when absent: a member with no transactions genuinely
 * has a balance of zero, and drawing that same zero for "not loaded" would
 * state a fact the screen does not know yet.
 */
export function selectPointsBalance(data: unknown): number | null {
  if (!isRecord(data)) return null;
  const balance = data.balance;
  return typeof balance === "number" && Number.isFinite(balance)
    ? balance
    : null;
}

/**
 * Approved service minutes, summed from the member's own entries.
 *
 * Approved only, matching how the chapter leaderboard counts them
 * (`get_service_leaderboard` covers APPROVED rows): pending time is not yet
 * credited, and showing it would overstate what the member has banked.
 *
 * `null` when there is no payload, as `selectPointsBalance` returns it: a
 * member with no entries really has zero minutes, and drawing that zero while
 * the request is in flight, or after it failed, states a fact the screen does
 * not have.
 */
export function sumApprovedServiceMinutes(data: unknown): number | null {
  if (!Array.isArray(data)) return null;
  let total = 0;
  for (const row of data) {
    if (!isRecord(row) || row.status !== "APPROVED") continue;
    const minutes = row.duration_minutes;
    if (typeof minutes === "number" && Number.isFinite(minutes)) {
      total += minutes;
    }
  }
  return total;
}

/** Minutes to an hour count, e.g. `1110` → `"18.5"`; a whole hour drops the decimal. */
export function formatServiceHours(minutes: number): string {
  const hours = minutes / 60;
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

/** The note under the cards when a read failed, or `null` when none did. */
export function profileStatsErrorNote(
  pointsFailed: boolean,
  serviceFailed: boolean,
): string | null {
  if (pointsFailed && serviceFailed) {
    return "Points and service hours couldn't load just now.";
  }
  if (pointsFailed) return "Points couldn't load just now.";
  if (serviceFailed) return "Service hours couldn't load just now.";
  return null;
}

/** What the stat cards draw: each value `null` until its read answers. */
export interface ProfileStats {
  /** The balance, or `null` for "—". */
  points: number | null;
  /** Approved hours as text, or `null` for "—". */
  serviceHours: string | null;
  /** Points are chapter-scoped: without an active chapter neither card can fill. */
  hasChapter: boolean;
  pointsFailed: boolean;
  serviceFailed: boolean;
}

/**
 * The viewer's points and approved service hours.
 *
 * The service read is scoped to the viewer: unscoped, the endpoint hands a
 * `service:approve` holder the whole chapter, and these cards present the
 * total as the viewer's own.
 */
export function useMyProfileStats(): ProfileStats {
  const chapterId = useActiveChapterId();
  const viewerUserId = useViewerUserId();
  const pointsQuery = useMyPoints();
  const serviceQuery = useServiceEntries(viewerUserId ?? undefined, undefined, {
    enabled: !!viewerUserId,
  });
  const minutes = sumApprovedServiceMinutes(serviceQuery.data);
  return {
    points: selectPointsBalance(pointsQuery.data),
    serviceHours: minutes === null ? null : formatServiceHours(minutes),
    hasChapter: !!chapterId,
    pointsFailed: pointsQuery.isError,
    serviceFailed: serviceQuery.isError,
  };
}
