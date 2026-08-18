/**
 * The balance + house-rank card at the top of s08.
 *
 * This is the surviving half of the deleted `points.tsx` / `points-details.tsx`
 * routes — `spec/ui/mobile/screens.md` records that their leaderboard UI
 * "re-lands as those stat cards", and this is that landing.
 *
 * Neither `/v1/points/me` nor `/v1/points/leaderboard` declares a response
 * schema in `openapi.json`, so both infer as `never` and are narrowed here with
 * the shared readers, as everywhere else in this app.
 *
 * ## Two things the drawn copy claims that the API does not
 *
 * **"Semester points" can silently be all-time.** `PointsService.getSemesterRange`
 * returns `undefined` for a chapter with no semester archive, and
 * `filterByWindow` then returns every transaction unfiltered. The response
 * carries no resolved window, so this client cannot detect the fallback or
 * relabel itself. The drawn label is kept and the gap is filed.
 *
 * **"of 42" is not the chapter's size.** `getLeaderboard` groups *transactions*,
 * so its rows are only members who moved the ledger inside the window. The
 * denominator therefore means "of members with points this window". It is still
 * the right number to draw: rank and denominator must come from one population,
 * and mixing in `useMembers().length` would render "#3 of 42" where the 3 is a
 * rank among 9.
 */

import { num, records, str } from "@/lib/more/narrow";

export interface PointsSummary {
  balance: number;
}

export interface HouseRank {
  rank: number;
  of: number;
}

/**
 * The viewer's balance, or `null` when the payload cannot be read.
 *
 * `null` and `0` are different answers and the card draws them differently: a
 * real zero renders "0", while `null` renders an em dash. Headlining a "0" at a
 * member who has 1,240 points is the failure the `hasEntries` discipline in
 * `app/(tabs)/service-hours.tsx` exists to prevent.
 */
export function selectPointsSummary(data: unknown): PointsSummary | null {
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const balance = num(data as Record<string, unknown>, "balance");
  return balance === null ? null : { balance };
}

/**
 * The viewer's standing, or `null` when they are absent from the leaderboard —
 * which is the ordinary case for a member with no transactions this window, and
 * must render as an em dash rather than a last place they did not earn.
 *
 * **Competition ranking**, not an array index: two members on 1,240 are both
 * `#3` and the next is `#5`. Index-based ranking would hand one of the tied
 * members `#4`, which is wrong in a way members notice immediately.
 */
export function selectHouseRank(
  data: unknown,
  viewerUserId: string | null,
): HouseRank | null {
  if (!viewerUserId) return null;

  const rows = records(data)
    .map((row) => {
      const userId = str(row, "user_id");
      const total = num(row, "total");
      return userId !== null && total !== null ? { userId, total } : null;
    })
    .filter((row): row is { userId: string; total: number } => row !== null);

  if (rows.length === 0) return null;

  const mine = rows.find((row) => row.userId === viewerUserId);
  if (!mine) return null;

  const ahead = rows.filter((row) => row.total > mine.total).length;
  return { rank: ahead + 1, of: rows.length };
}
