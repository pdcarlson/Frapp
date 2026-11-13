import { formatServiceHours, type ServiceLeaderboardRow } from "@repo/hooks";

/**
 * The numbers at the top of `/service` (#4669): the viewer's own approved
 * hours this semester and all time, and what is still waiting on review.
 *
 * Approved only for the two totals, as the leaderboard and the phone's
 * summary card count (`apps/mobile/lib/more/service-hours.ts`): pending time
 * isn't credited yet, so it stands beside them rather than inside them.
 */
export type OwnServiceTotals = {
  /** `null` while the semester's start is unknown (loading, or its read failed). */
  semesterMinutes: number | null;
  allTimeMinutes: number;
  pendingMinutes: number;
  pendingCount: number;
};

type TotalsEntry = { status: string; date: string; duration_minutes: number };

/**
 * `semesterStart` is the first day of this semester as `YYYY-MM-DD`
 * (`serviceSemesterStartDate`), `null` for a chapter that never rolled over
 * (this semester is all time), and `undefined` while it is unknown. Entries are
 * the viewer's own; the caller filters them.
 */
export function ownServiceTotals(
  entries: readonly TotalsEntry[],
  semesterStart: string | null | undefined,
): OwnServiceTotals {
  let allTimeMinutes = 0;
  let semesterMinutes = 0;
  let pendingMinutes = 0;
  let pendingCount = 0;
  for (const entry of entries) {
    const minutes = Number.isFinite(entry.duration_minutes)
      ? entry.duration_minutes
      : 0;
    if (entry.status === "PENDING") {
      pendingMinutes += minutes;
      pendingCount += 1;
    } else if (entry.status === "APPROVED") {
      allTimeMinutes += minutes;
      // Bare `YYYY-MM-DD` on both sides, so a string compare is a date compare
      // and no time zone can move an entry across the line.
      if (
        semesterStart === null ||
        (semesterStart !== undefined &&
          entry.date.slice(0, 10) >= semesterStart)
      ) {
        semesterMinutes += minutes;
      }
    }
  }
  return {
    semesterMinutes: semesterStart === undefined ? null : semesterMinutes,
    allTimeMinutes,
    pendingMinutes,
    pendingCount,
  };
}

/** `90` → `"1.5 h"`, `0` → `"0 h"`: the stat and leaderboard number. */
export function hoursLabel(minutes: number): string {
  return `${formatServiceHours(minutes)} h`;
}

export type RankedServiceRow = ServiceLeaderboardRow & {
  /** 1-based place; equal totals share one (1, 1, 3), as the points board counts. */
  rank: number;
  isViewer: boolean;
};

/**
 * Places for the server's ranking (approved minutes descending, then name).
 * Equal totals share a place, the way `/points` and the phone's points card
 * number a tie, so two members on the same hours never read as first and
 * second.
 */
export function rankServiceLeaderboard(
  rows: readonly ServiceLeaderboardRow[],
  viewerUserId: string | null,
): RankedServiceRow[] {
  let rank = 0;
  let previous: number | null = null;
  return rows.map((row, index) => {
    if (row.total_minutes !== previous) {
      rank = index + 1;
      previous = row.total_minutes;
    }
    return {
      ...row,
      rank,
      isViewer: viewerUserId !== null && row.user_id === viewerUserId,
    };
  });
}

/**
 * How many rows the board shows before Show all: the top ten, as Strava's
 * club leaderboard opens. A viewer below them is pinned after a gap, so
 * their own place is always on screen without scrolling the whole chapter.
 */
export const LEADERBOARD_PREVIEW = 10;

/**
 * The rows to draw: all of them when expanded or when they fit; otherwise the
 * top {@link LEADERBOARD_PREVIEW} and, when the viewer is below them, the
 * viewer's own row as `pinned`.
 */
export function visibleLeaderboard(
  ranked: readonly RankedServiceRow[],
  expanded: boolean,
): { top: RankedServiceRow[]; pinned: RankedServiceRow | null } {
  if (expanded || ranked.length <= LEADERBOARD_PREVIEW) {
    return { top: [...ranked], pinned: null };
  }
  const top = ranked.slice(0, LEADERBOARD_PREVIEW);
  const viewerRow = ranked.find((row) => row.isViewer) ?? null;
  const pinned =
    viewerRow && !top.some((row) => row.isViewer) ? viewerRow : null;
  return { top, pinned };
}
