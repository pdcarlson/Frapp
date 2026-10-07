export const REPORT_REPOSITORY = 'REPORT_REPOSITORY';

/**
 * A read capped at `limit` rows, and whether the cap cut it short.
 *
 * `truncated` is observed, not inferred: the read asks for one row past the
 * cap, so a result of exactly `limit` rows is complete and is not labelled
 * truncated.
 */
export interface CappedRows<T> {
  rows: T[];
  truncated: boolean;
}

export interface AttendanceReportFilters {
  eventId?: string;
  /** `YYYY-MM-DD`, inclusive, compared against the event's start. */
  startDate?: string;
  /** `YYYY-MM-DD`, inclusive, compared against the event's start. */
  endDate?: string;
}

export interface AttendanceJoinedRow {
  status: string;
  check_in_time: string | null;
  events: { id: string; name: string; start_time: string } | null;
  users: { display_name: string } | null;
}

export interface PointsReportFilters {
  userId: string | null;
  since: Date | null;
  until: Date | null;
}

/** One `get_points_report` row; `total_points` may arrive as a bigint string. */
export interface PointsTotalsRow {
  member_name: string;
  total_points: number;
  breakdown_by_category: Record<string, number> | null;
}

export interface MemberRosterRow {
  user_id: string;
  role_ids: string[];
  created_at: string;
}

/**
 * One member's whole all-time balance, already summed by
 * `get_points_leaderboard` with both bounds null. `total` is `bigint` in SQL;
 * PostgREST serializes it as a JSON number.
 */
export interface MemberBalanceRow {
  user_id: string;
  total: number;
}

export interface ServiceReportFilters {
  userId?: string;
  /** `YYYY-MM-DD`, inclusive. */
  startDate?: string;
  /** `YYYY-MM-DD`, inclusive. */
  endDate?: string;
}

export interface ServiceEntryReportRow {
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  status: string;
}

/**
 * The reads behind the officer reports (`/v1/reports`). Each capped read pages
 * through the whole result in a total order, up to `limit` rows; how those rows
 * become a report is `ReportService`'s.
 */
export interface IReportRepository {
  /** Attendance rows for the chapter's events, with event and attendee joined. */
  findAttendance(
    chapterId: string,
    filters: AttendanceReportFilters,
    limit: number,
  ): Promise<CappedRows<AttendanceJoinedRow>>;
  /** Per-member point totals over the window, by `get_points_report`. */
  findPointsTotals(
    chapterId: string,
    filters: PointsReportFilters,
    limit: number,
  ): Promise<CappedRows<PointsTotalsRow>>;
  findRosterMembers(
    chapterId: string,
    limit: number,
  ): Promise<CappedRows<MemberRosterRow>>;
  /** All-time balances for every member who has scored in the chapter. */
  findMemberBalances(
    chapterId: string,
    limit: number,
  ): Promise<CappedRows<MemberBalanceRow>>;
  findServiceEntries(
    chapterId: string,
    filters: ServiceReportFilters,
    limit: number,
  ): Promise<CappedRows<ServiceEntryReportRow>>;
}
