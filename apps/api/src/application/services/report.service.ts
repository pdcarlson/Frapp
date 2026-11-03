import { Inject, Injectable } from '@nestjs/common';
import { SEMESTER_ARCHIVE_REPOSITORY } from '#domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '#domain/repositories/semester-archive.repository.interface';
import {
  resolveWindowSince,
  type PointsWindow,
} from '#domain/utils/points-window';
import { resolveSemesterArchiveRangeOrThrow } from './resolve-semester-archive-range';
import {
  REPORT_REPOSITORY,
  type IReportRepository,
} from '#domain/repositories/report.repository.interface';
import {
  ROLE_REPOSITORY,
  type IRoleRepository,
} from '#domain/repositories/role.repository.interface';
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '#domain/repositories/user.repository.interface';

export interface AttendanceReportRow {
  member_name: string;
  event_name: string;
  event_date: string;
  status: string;
  check_in_time: string | null;
}

export interface PointsReportRow {
  member_name: string;
  total_points: number;
  breakdown_by_category: Record<string, number>;
}

export interface RosterReportRow {
  name: string;
  email: string;
  roles: string[];
  join_date: string;
  point_balance: number;
}

export interface ServiceReportRow {
  member_name: string;
  date: string;
  duration_minutes: number;
  description: string;
  status: string;
}

export interface AttendanceReportInput {
  event_id?: string;
  start_date?: string;
  end_date?: string;
}

export interface PointsReportInput {
  user_id?: string;
  window?: PointsWindow;
  /** Selects one archived period by id, overriding `window`. See `PointsService`. */
  semester_archive_id?: string;
}

export interface ServiceReportInput {
  user_id?: string;
  start_date?: string;
  end_date?: string;
}

/**
 * Hard ceiling on the rows one report may return, in every format.
 *
 * Set by the PDF path, which is the expensive one and the reason a bound
 * exists at all: pdf-lib renders synchronously, so its cost is not paid by the
 * requesting call alone — it blocks the event loop, and Node serves every
 * other chapter from that same thread. Measured on the local stack rendering a
 * service report:
 *
 * | rows | render | heap |
 * | --- | --- | --- |
 * | 1,000 | 0.34 s | 16 MB |
 * | 5,000 | 1.08 s | 65 MB |
 * | 10,000 | 2.04 s | 28 MB |
 * | 20,000 | 4.10 s | 267 MB |
 *
 * (Render time is the dependable column, near-linear at ~0.2 ms/row. The heap
 * figures are single unforced samples — indicative, not exact.)
 *
 * 5,000 keeps the worst-case stall near a second. 20,000 would mean one
 * officer's export freezing every other tenant's requests for four seconds and
 * spiking a quarter-gigabyte — a worse failure than the truncation this
 * replaces, and one paging would newly make reachable (before it, PostgREST's
 * 1000-row cap meant the renderer never saw more than the top row of this
 * table). The same number applies to `json` and `csv`, which are far cheaper,
 * because one ceiling that holds everywhere beats three that need explaining.
 *
 * Unlike `max_rows`, hitting it is never silent — `ReportResult.truncated`
 * carries it out to every format.
 */
export const REPORT_MAX_ROWS = 5_000;

/**
 * Ceiling on rows read only to aggregate a number that lands in the document
 * — roster balances, not roster lines themselves.
 *
 * Higher than `REPORT_MAX_ROWS` because these rows never reach the renderer.
 * The pages are read sequentially, each waiting on the last, so the ceiling is
 * really a latency budget rather than a render cost: at 50,000 that is up to
 * 50 round-trips (~1.2 s by the measurement in `docs/performance/reports.md`),
 * plus the one terminating empty request `fetchAllPages` always pays, before
 * any rendering starts. That arithmetic is unchanged by #567 — what changed is how many rows
 * it takes to get there.
 *
 * **It counts scoring members, not transactions (#567).** Balances come from
 * `get_points_leaderboard`, which groups by `user_id`, so a chapter costs one
 * row per member who has ever scored in it rather than one row per
 * transaction. That still grows with the chapter's life — an alumnus's rows
 * keep their group — but per *member*, not per *entry*, which is the whole
 * difference: the transaction stream this replaced could cross 50,000 in one
 * active semester and then reported wrong balances behind a footnote.
 *
 * The branch below stays because the bound is still real, not because it is
 * expected to fire. With the roster itself capped at `REPORT_MAX_ROWS`, firing
 * it needs a chapter with 50,000 distinct scorers on record.
 */
export const REPORT_AGGREGATE_MAX_ROWS = 50_000;

/**
 * A report's rows plus whether {@link REPORT_MAX_ROWS} cut them short.
 *
 * `truncated` is the point of the type: a short report that does not say it is
 * short reads as a complete record of the chapter, and these get emailed to
 * nationals and advisors.
 */
export interface ReportResult<T> {
  rows: T[];
  truncated: boolean;
  /**
   * The ceiling that `truncated` refers to. Carried rather than assumed
   * because a report can be cut short by more than one limit — a roster is
   * bounded by `REPORT_MAX_ROWS` rows but its balances are bounded by
   * `REPORT_AGGREGATE_MAX_ROWS` members, and reporting the wrong one
   * gives an officer a number that contradicts the document in front of them.
   */
  limit: number;
  /**
   * What was cut, when the row count alone does not say it. Set only where
   * truncation corrupts a value instead of shortening the list.
   */
  note?: string;
}

@Injectable()
export class ReportService {
  constructor(
    @Inject(REPORT_REPOSITORY) private readonly reports: IReportRepository,
    @Inject(SEMESTER_ARCHIVE_REPOSITORY)
    private readonly semesterArchiveRepo: ISemesterArchiveRepository,
    @Inject(USER_REPOSITORY) private readonly users: IUserRepository,
    @Inject(ROLE_REPOSITORY) private readonly roles: IRoleRepository,
  ) {}

  /**
   * Attendance rows for a chapter, scoped by the event filters. The join and
   * why it is shaped as it is (`events!inner`, the named `users` foreign key,
   * #746) are `SupabaseReportRepository.findAttendance`'s.
   */
  async getAttendanceReport(
    chapterId: string,
    input: AttendanceReportInput,
  ): Promise<ReportResult<AttendanceReportRow>> {
    const { rows: joined, truncated } = await this.reports.findAttendance(
      chapterId,
      {
        eventId: input.event_id,
        startDate: input.start_date,
        endDate: input.end_date,
      },
      REPORT_MAX_ROWS,
    );

    const rows = joined.map((row) => {
      const startTime = row.events?.start_time ?? '';
      const eventDate = startTime ? startTime.split('T')[0] : '';

      return {
        member_name: row.users?.display_name ?? '',
        event_name: row.events?.name ?? '',
        event_date: eventDate,
        status: row.status,
        check_in_time: row.check_in_time,
      };
    });

    rows.sort((a, b) =>
      (a.event_date + a.member_name).localeCompare(
        b.event_date + b.member_name,
      ),
    );
    return { rows, truncated, limit: REPORT_MAX_ROWS };
  }

  async getPointsReport(
    chapterId: string,
    input: PointsReportInput,
  ): Promise<ReportResult<PointsReportRow>> {
    // Selecting a specific archived period by id overrides `window` entirely —
    // same precedence as PointsService.getLeaderboard/getUserSummary, and the
    // same chapter-scoped lookup so a foreign id 404s like an unknown one.
    let since: Date | null;
    let until: Date | null = null;
    if (input.semester_archive_id) {
      const range = await resolveSemesterArchiveRangeOrThrow(
        this.semesterArchiveRepo,
        input.semester_archive_id,
        chapterId,
      );
      since = range.since;
      until = range.until;
    } else {
      const window: PointsWindow = input.window ?? 'all';
      // Resolve the window's lower bound with the same helper the leaderboard
      // uses (points.service.ts) so report totals match the leaderboard for
      // the same window. Only the semester window needs the latest archive.
      let latestArchiveEndDate: string | null = null;
      if (window === 'semester') {
        const archive =
          await this.semesterArchiveRepo.findLatestByChapter(chapterId);
        latestArchiveEndDate = archive?.end_date ?? null;
      }
      since = resolveWindowSince(window, {
        now: new Date(),
        latestArchiveEndDate,
      });
    }

    // Paged like every report read; why an RPC pages, and the ordering tie it
    // cannot break (#747), are `SupabaseReportRepository.findPointsTotals`'.
    const { rows, truncated } = await this.reports.findPointsTotals(
      chapterId,
      { userId: input.user_id || null, since, until },
      REPORT_MAX_ROWS,
    );

    return {
      rows: rows.map((row) => ({
        member_name: row.member_name,
        total_points: Number(row.total_points),
        breakdown_by_category: row.breakdown_by_category || {},
      })),
      truncated,
      limit: REPORT_MAX_ROWS,
    };
  }

  async getRosterReport(
    chapterId: string,
  ): Promise<ReportResult<RosterReportRow>> {
    const { rows: members, truncated: membersTruncated } =
      await this.reports.findRosterMembers(chapterId, REPORT_MAX_ROWS);
    if (!members.length)
      return { rows: [], truncated: membersTruncated, limit: REPORT_MAX_ROWS };

    const userIds = members.map((m) => m.user_id);

    // ⚡ Bolt: Parallelize independent DB queries to eliminate sequential
    // network roundtrips. Expected impact: Reduces latency during roster
    // generation by fetching users and point balances concurrently.
    //
    // Balances are one already-summed row per scoring member (#567), read
    // through `get_points_leaderboard` with no window (#1743); the repository
    // carries why, and why that read pages on `user_id`.
    const [users, balanceRows, roles] = await Promise.all([
      this.users.findContactsByIds(userIds),
      this.reports.findMemberBalances(chapterId, REPORT_AGGREGATE_MAX_ROWS),
      // Every role the chapter defines: a chapter holds a handful, so the
      // owning repository's chapter read needs no paging or id list.
      this.roles.findByChapter(chapterId),
    ]);

    const userMap = new Map(
      users.map(
        (u) =>
          [u.id, { display_name: u.display_name, email: u.email }] as const,
      ),
    );

    // One row per member now, so this is a lookup table rather than a
    // reduction. `Number(...)` because the SQL type is `bigint`: PostgREST
    // serializes it as a JSON number, but the same cast guards the string form
    // some drivers hand back for 64-bit integers.
    //
    // `?? 0` guards a missing FIELD, not a null total: `amount` is `int not
    // null` on `point_transactions`, so within `group by pt.user_id` every
    // group has at least one non-null row and `sum` cannot come back null.
    // What it does buy is that `Number(undefined)` is `NaN`, and a NaN balance
    // does not throw — it renders as "NaN" in the PDF and CSV an officer
    // downloads. Cheap insurance against a shape this file does not own.
    const balances = new Map<string, number>(
      balanceRows.rows.map((b) => [b.user_id, Number(b.total ?? 0)]),
    );

    // Unmatched entries in the map are inert — it is only ever read by a
    // member's own `role_ids`.
    const roleMap = new Map(roles.map((r) => [r.id, r.name] as const));

    const rows = members.map((m) => {
      const u = userMap.get(m.user_id);
      const roleNames = (m.role_ids ?? []).map(
        (rid: string) => roleMap.get(rid) ?? rid,
      );
      return {
        name: u?.display_name ?? '',
        email: u?.email ?? '',
        roles: roleNames,
        join_date: m.created_at.split('T')[0] ?? '',
        point_balance: balances.get(m.user_id) ?? 0,
      };
    });

    // A truncated balance read is not a short roster — it is a roster of the
    // right length carrying *wrong* balances, which no row count reveals. It
    // counts as truncation so the report still declares itself incomplete, but
    // it reports its own ceiling and says which field is wrong: labelling a
    // complete 300-line roster "capped at 5,000 rows" reads as a false
    // positive, and the reader goes looking for missing members instead of
    // distrusting the balances.
    //
    // The ceiling counts scoring members rather than transactions now (#567);
    // `REPORT_AGGREGATE_MAX_ROWS` carries why that stops being a cliff. What
    // matters here is that the note has to say which, or it sends the reader
    // looking at transaction volume for a members-shaped bound.
    if (balanceRows.truncated) {
      const balanceNote = `point balances are incomplete — summed for the first ${REPORT_AGGREGATE_MAX_ROWS.toLocaleString('en-US')} members`;
      return {
        rows,
        truncated: true,
        // Both ceilings can bite at once. Reporting only the aggregate one
        // would leave the roster's own cut unmentioned, so the row limit stays
        // the headline whenever it applied and the balances ride in the note.
        limit: membersTruncated ? REPORT_MAX_ROWS : REPORT_AGGREGATE_MAX_ROWS,
        note: membersTruncated
          ? `roster capped at ${REPORT_MAX_ROWS.toLocaleString('en-US')} members, and ${balanceNote}`
          : balanceNote,
      };
    }
    return { rows, truncated: membersTruncated, limit: REPORT_MAX_ROWS };
  }

  async getServiceReport(
    chapterId: string,
    input: ServiceReportInput,
  ): Promise<ReportResult<ServiceReportRow>> {
    const { rows: entries, truncated } = await this.reports.findServiceEntries(
      chapterId,
      {
        userId: input.user_id,
        startDate: input.start_date,
        endDate: input.end_date,
      },
      REPORT_MAX_ROWS,
    );
    if (!entries.length) return { rows: [], truncated, limit: REPORT_MAX_ROWS };

    const userIds = [...new Set(entries.map((e) => e.user_id))];
    const users = await this.users.findDisplayIdentitiesByIds(userIds);
    const userMap = new Map<string, string>(
      users.map((u) => [u.id, u.display_name]),
    );

    const rows = entries.map((e) => ({
      member_name: userMap.get(e.user_id) ?? '',
      date: e.date,
      duration_minutes: e.duration_minutes,
      description: e.description,
      status: e.status,
    }));
    return { rows, truncated, limit: REPORT_MAX_ROWS };
  }
}
