import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../supabase.provider';
import type { FrappSupabaseClient } from '../database.types';
import { type PagedQueryResult, fetchAllPages } from '../supabase.utils';
import { SupabaseQueryError } from '../supabase-query-error';
import { chunkIds } from '#domain/utils/chunk-ids';
import type {
  AttendanceJoinedRow,
  AttendanceReportFilters,
  CappedRows,
  IReportRepository,
  MemberBalanceRow,
  MemberRosterRow,
  PointsReportFilters,
  PointsTotalsRow,
  RoleNameRow,
  ServiceEntryReportRow,
  ServiceReportFilters,
  UserContactRow,
} from '#domain/repositories/report.repository.interface';

type QueryResult<T> = PagedQueryResult<T>;

/**
 * Rows requested per round-trip.
 *
 * A request size, not an assumption about the server's cap — see
 * `fetchAllPages` in `../supabase.utils.ts`, which is the one home for why that
 * holds. Every paged read in the API shares that rule; the "hold the page size
 * below the cap instead" reasoning that used to be cited here was #1628's bug,
 * not a second safe strategy.
 */
export const REPORT_PAGE_SIZE = 1000;

/**
 * Read a query's full result set, one {@link REPORT_PAGE_SIZE} page at a time,
 * and report honestly whether `limit` stopped it early.
 *
 * `page` must apply a **total** order — every table read here sorts on the
 * table's `id`, which is selected for ordering but need not be projected.
 * Offset paging over a non-unique sort key has no guaranteed order between
 * statements, so rows sharing a sort value across a page boundary can come back
 * twice or vanish entirely.
 *
 * A total order rules out *that* shuffling; it does not make the read a
 * snapshot. These are separate statements, so a row inserted or deleted between
 * two pages still shifts the window and can duplicate or skip one row at the
 * boundary. Reports are point-in-time summaries rather than ledgers, so that is
 * accepted rather than solved — a keyset cursor would be the fix if it ever
 * stops being.
 *
 * One row past the ceiling is requested so `truncated` is an observed fact
 * rather than an inference from a full final page: a result of exactly `limit`
 * rows is complete, not short, and must not be labelled as truncated.
 */
async function fetchCapped<T>(
  page: (from: number, to: number) => PromiseLike<QueryResult<T>>,
  limit: number,
): Promise<CappedRows<T>> {
  // The empty-page termination, the advance-by-what-arrived rule and the
  // `SupabaseQueryError` a failed page throws all live in the shared helper;
  // see `supabase.utils.ts` for why each is load-bearing. What stays here is
  // report-specific: the `limit + 1` read that makes `truncated` an observed
  // fact.
  const rows = await fetchAllPages<T>(page, {
    pageSize: REPORT_PAGE_SIZE,
    limit: limit + 1,
  });

  const truncated = rows.length > limit;
  return { rows: truncated ? rows.slice(0, limit) : rows, truncated };
}

@Injectable()
export class SupabaseReportRepository implements IReportRepository {
  constructor(
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * The chapter and date filters are applied to the embedded `events` resource
   * with `!inner` rather than by first collecting event IDs and passing them
   * back as an `in` list. The two-step version could not be paged safely: a
   * chapter with more events than `max_rows` silently lost the overflow, and
   * lifting that cap would push thousands of UUIDs into a query string.
   *
   * `users` **must** name its foreign key. `event_attendance` reaches `users`
   * twice — `user_id` and `marked_by` — and a bare `users(...)` embed is
   * rejected by PostgREST as ambiguous (`PGRST201`), which failed this endpoint
   * in every environment (#746). `user_id` is the attendee; `marked_by` is the
   * officer who recorded them.
   */
  async findAttendance(
    chapterId: string,
    filters: AttendanceReportFilters,
    limit: number,
  ): Promise<CappedRows<AttendanceJoinedRow>> {
    return fetchCapped<AttendanceJoinedRow>((from, to) => {
      let query = this.supabase
        .from('event_attendance')
        .select(
          `
        status,
        check_in_time,
        events!inner (id, name, start_time),
        users!event_attendance_user_id_fkey (display_name)
      `,
        )
        .eq('events.chapter_id', chapterId);

      if (filters.eventId) {
        query = query.eq('events.id', filters.eventId);
      }
      if (filters.startDate) {
        query = query.gte(
          'events.start_time',
          `${filters.startDate}T00:00:00.000Z`,
        );
      }
      if (filters.endDate) {
        query = query.lte(
          'events.start_time',
          `${filters.endDate}T23:59:59.999Z`,
        );
      }

      return query
        .order('id', { ascending: true })
        .range(from, to) as PromiseLike<QueryResult<AttendanceJoinedRow>>;
    }, limit);
  }

  /**
   * An RPC result set is subject to `max_rows` exactly like a table read, so
   * this pages too — and on the same terms, deliberately. PostgREST applies
   * `LIMIT`/`OFFSET` *outside* the function call, so the trailing empty request
   * re-runs `get_points_report` in full rather than costing an indexed scan of
   * nothing: one redundant `GROUP BY` per points report. That is accepted.
   * Ending on a short page instead would make this read — alone among them —
   * silently truncate whenever the server's `max_rows` sat below the page size,
   * which is the precise failure paging exists to remove, traded away for a few
   * milliseconds on an admin action nobody runs in a loop.
   *
   * `member_name` is also the only orderable column the function returns — it
   * exposes no key — so two members sharing a display name across a page
   * boundary is an ordering tie this cannot break. Reaching that needs more
   * members in one chapter than a page holds; carrying `user_id` out of the
   * RPC is tracked separately (#747).
   */
  async findPointsTotals(
    chapterId: string,
    filters: PointsReportFilters,
    limit: number,
  ): Promise<CappedRows<PointsTotalsRow>> {
    return fetchCapped<PointsTotalsRow>(
      (from, to) =>
        this.supabase
          .rpc('get_points_report', {
            p_chapter_id: chapterId,
            p_user_id: filters.userId,
            p_since: filters.since ? filters.since.toISOString() : null,
            p_until: filters.until ? filters.until.toISOString() : null,
          })
          .order('member_name', { ascending: true })
          .range(from, to),
      limit,
    );
  }

  async findRosterMembers(
    chapterId: string,
    limit: number,
  ): Promise<CappedRows<MemberRosterRow>> {
    return fetchCapped<MemberRosterRow>(
      (from, to) =>
        this.supabase
          .from('members')
          .select('user_id, role_ids, created_at')
          .eq('chapter_id', chapterId)
          .order('id', { ascending: true })
          .range(from, to),
      limit,
    );
  }

  /**
   * Summed by Postgres, one row per member, rather than streamed in as one row
   * per transaction (#567). Scoped by chapter alone; the caller matches it
   * against the roster in memory. Filtering on `user_id` as well would mean an
   * `in` list holding every member — for a filter that changes nothing: a
   * balance is only ever read back for a member's own ID, so a departed
   * member's residual rows are inert.
   *
   * `get_points_leaderboard` with both bounds null, rather than a roster-only
   * aggregate of its own (#1743). The two would be the same `group by
   * pt.user_id` over the same table with the same grants, and the roster needs
   * no window: a roster balance is the member's all-time chapter total, which
   * is exactly what unbounded means here. Null bounds are the function's
   * documented "no window" case, not a coincidence of its filter —
   * `getLeaderboard` sends the same nulls for the `all` window.
   *
   * Still paged, on the same terms as {@link findPointsTotals}: PostgREST
   * applies `max_rows` to an RPC result set exactly as to a table read. The
   * order is on `user_id`, which the function groups by and is therefore unique
   * across the result — a total order, so no *tie* can duplicate or drop a row
   * across a page boundary. Ordering here overrides the function's own `order
   * by total desc`, which the leaderboard needs and the roster must not page
   * on: `total` is not unique. (`get_points_report` cannot offer either: it
   * returns no key and can only tie-break on display name, which is the whole
   * of #747.)
   *
   * A total order is not a snapshot, and does not claim to be: a paged read is
   * several statements, so a concurrent write can still shift a boundary
   * ({@link fetchCapped}'s docstring says so). That is the report-wide caveat in
   * `docs/performance/reports.md`, not something this ordering fixes.
   *
   * What DID change is the shape of that rare failure, and it cuts both ways. A
   * row inserted between pages used to double-count one transaction; now a
   * duplicated aggregate row just rewrites the caller's Map with the same
   * value, which is harmless. But a delete that removes a member's whole group
   * no longer shaves one transaction off their balance — it drops the group,
   * and they render as 0. Both need a chapter past one page of scoring members
   * plus a concurrent write mid-report.
   */
  async findMemberBalances(
    chapterId: string,
    limit: number,
  ): Promise<CappedRows<MemberBalanceRow>> {
    return fetchCapped<MemberBalanceRow>(
      (from, to) =>
        this.supabase
          .rpc('get_points_leaderboard', {
            p_chapter_id: chapterId,
            p_since: null,
            p_until: null,
          })
          .order('user_id', { ascending: true })
          .range(from, to),
      limit,
    );
  }

  /**
   * Every role the chapter defines, rather than the subset a roster mentions:
   * `roles` is already chapter-scoped and a chapter holds a handful of them, so
   * filtering by ID bought nothing but an `in (...)` list long enough to need
   * chunking.
   */
  async findRoleNames(
    chapterId: string,
    limit: number,
  ): Promise<RoleNameRow[]> {
    const { rows } = await fetchCapped<RoleNameRow>(
      (from, to) =>
        this.supabase
          .from('roles')
          .select('id, name')
          .eq('chapter_id', chapterId)
          .order('id', { ascending: true })
          .range(from, to),
      limit,
    );
    return rows;
  }

  async findServiceEntries(
    chapterId: string,
    filters: ServiceReportFilters,
    limit: number,
  ): Promise<CappedRows<ServiceEntryReportRow>> {
    return fetchCapped<ServiceEntryReportRow>((from, to) => {
      let query = this.supabase
        .from('service_entries')
        .select('user_id, date, duration_minutes, description, status')
        .eq('chapter_id', chapterId);

      if (filters.userId) {
        query = query.eq('user_id', filters.userId);
      }
      if (filters.startDate) {
        query = query.gte('date', filters.startDate);
      }
      if (filters.endDate) {
        query = query.lte('date', filters.endDate);
      }

      // `date` alone is not unique, so it cannot order a paged read on its own
      // — `id` breaks the ties that would otherwise duplicate or drop entries
      // sharing a date across a page boundary.
      return query
        .order('date', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to);
    }, limit);
  }

  async findUserContacts(ids: string[]): Promise<UserContactRow[]> {
    const pages = await Promise.all(
      chunkIds(ids).map(
        (chunk) =>
          this.supabase
            .from('users')
            .select('id, display_name, email')
            .in('id', chunk) as PromiseLike<QueryResult<UserContactRow>>,
      ),
    );
    return pages.flatMap((page) => {
      if (page.error) throw new SupabaseQueryError(page.error);
      return page.data ?? [];
    });
  }
}
