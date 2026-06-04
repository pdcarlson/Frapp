/**
 * Points time-window resolution, shared by the points leaderboard
 * (`PointsService`) and the points report (`ReportService`) so both answer the
 * same question for the same window. Keeping the boundary math in one pure,
 * dependency-free place is what guarantees report totals match the leaderboard —
 * the report RPC never re-derives "what is a semester" in SQL.
 */

/** The supported points time windows — the single source of truth for the type
 * and for DTO validation (`report.dto.ts`, `points.dto.ts`). */
export const POINTS_WINDOWS = ['all', 'semester', 'month'] as const;

export type PointsWindow = (typeof POINTS_WINDOWS)[number];

/**
 * Resolve the lower bound for a points window.
 *
 * Returns a `Date` to compare against `created_at`, or `null` for all-time. The
 * caller injects `now` and the latest semester archive's `end_date` so this stays
 * pure and trivially testable.
 *
 * - `all`      → `null` (no filter).
 * - `month`    → `now − 1 calendar month` (mirrors `Date.setMonth(getMonth()-1)`).
 * - `semester` → end of the latest archive's `end_date` calendar day
 *   (`…T23:59:59.999Z`), i.e. a transaction recorded on the `end_date` day belongs
 *   to the archived period, not the active one (see
 *   `spec/behavior/semester-rollover.md`). Returns `null` when there is no archive
 *   (or an unparseable one) → caller falls back to all-time, matching
 *   `semester-rollover.md`.
 *
 * Both consumers apply the bound as an **exclusive** lower bound (`created_at >
 * since` in the leaderboard's `filterByWindow` and `created_at > p_since` in the
 * report RPC), so the leaderboard and the report never disagree for a window.
 */
export function resolveWindowSince(
  window: PointsWindow,
  opts: { now: Date; latestArchiveEndDate?: string | null },
): Date | null {
  switch (window) {
    case 'all':
      return null;
    case 'month': {
      const since = new Date(opts.now);
      since.setMonth(since.getMonth() - 1);
      return since;
    }
    case 'semester': {
      if (!opts.latestArchiveEndDate) return null;
      const since = new Date(
        `${opts.latestArchiveEndDate.slice(0, 10)}T23:59:59.999Z`,
      );
      return Number.isNaN(since.getTime()) ? null : since;
    }
    default: {
      // Exhaustiveness: adding a PointsWindow value without handling it here is a
      // compile error, preventing a silent all-time fallback for a new window.
      const _exhaustive: never = window;
      return _exhaustive;
    }
  }
}
