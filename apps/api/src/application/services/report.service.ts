import { Inject, Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import {
  resolveWindowSince,
  type PointsWindow,
} from '../../domain/utils/points-window';

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
}

export interface ServiceReportInput {
  user_id?: string;
  start_date?: string;
  end_date?: string;
}

interface QueryError {
  message: string;
}

interface QueryResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

/**
 * Rows fetched per round-trip. PostgREST caps any single response at
 * `max_rows` (1000, `supabase/config.toml`), so asking for more in one request
 * silently gets you 1000 — the exact bug this paging exists to close.
 */
const REPORT_PAGE_SIZE = 1000;

/**
 * Hard ceiling on the rows one report may return, in every format.
 *
 * Paging past `max_rows` without a bound would trade a silent-truncation bug
 * for a timeout: a report is rendered synchronously in-process, and FRA-19
 * measured 40,000 rows costing 5.3 MB and ~7.7 s of mostly-synchronous pdf-lib
 * work. This sits at roughly half that. Unlike `max_rows`, hitting it is never
 * silent — `ReportResult.truncated` carries it out to every format.
 */
export const REPORT_MAX_ROWS = 20_000;

/**
 * Ceiling on rows read only to aggregate a number that lands in the document
 * — point transactions behind a roster balance, not roster lines themselves.
 * These never reach the renderer, so the bound is about memory rather than
 * render cost, and sits an order of magnitude higher.
 */
const REPORT_AGGREGATE_MAX_ROWS = 200_000;

/**
 * How many IDs one `in (...)` filter may carry. Keeps the generated query
 * string comfortably inside the smallest proxy limit these requests pass
 * through: 500 UUIDs is roughly 19 KB of URL.
 */
const ID_CHUNK_SIZE = 500;

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
}

interface AttendanceJoinedRow {
  status: string;
  check_in_time: string | null;
  event_id: string;
  events: { id: string; name: string; start_time: string } | null;
  users: { display_name: string } | null;
}

interface UserNameRow {
  id: string;
  display_name: string;
}

interface MemberRosterRow {
  id: string;
  user_id: string;
  role_ids: string[];
  created_at: string;
}

interface UserRosterRow {
  id: string;
  display_name: string;
  email: string;
}

interface UserAmountRow {
  id: string;
  user_id: string;
  amount: number;
}

interface RoleNameRow {
  id: string;
  name: string;
}

interface ServiceEntryRow {
  id: string;
  user_id: string;
  date: string;
  duration_minutes: number;
  description: string;
  status: string;
}

interface PointsReportRpcRow {
  member_name: string;
  total_points: number;
  breakdown_by_category: Record<string, number>;
}

function throwIfError(error: QueryError | null): void {
  if (error) {
    throw new Error(error.message);
  }
}

/**
 * Read a query's full result set, one `REPORT_PAGE_SIZE` page at a time, and
 * report honestly whether {@link REPORT_MAX_ROWS} stopped it early.
 *
 * `page` must apply a **total** order — every caller here sorts on the table's
 * `id`. Offset paging over a non-unique sort key has no guaranteed order
 * between statements, so rows sharing a sort value across a page boundary can
 * come back twice or vanish entirely.
 *
 * One row past the ceiling is requested so `truncated` is an observed fact
 * rather than an inference from a full final page: a result of exactly
 * `REPORT_MAX_ROWS` rows is complete, not short, and must not be labelled as
 * truncated.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<QueryResult<T>>,
  limit: number = REPORT_MAX_ROWS,
): Promise<ReportResult<T>> {
  const readLimit = limit + 1;
  const rows: T[] = [];

  for (let from = 0; from < readLimit; from += REPORT_PAGE_SIZE) {
    const to = Math.min(from + REPORT_PAGE_SIZE, readLimit) - 1;
    const { data, error } = await page(from, to);
    throwIfError(error);

    const batch = data ?? [];
    rows.push(...batch);
    // A short page means the data ran out, not that the ceiling was hit.
    if (batch.length < to - from + 1) break;
  }

  const truncated = rows.length > limit;
  return {
    rows: truncated ? rows.slice(0, limit) : rows,
    truncated,
  };
}

/**
 * Split IDs into batches small enough that the resulting `in` list cannot
 * overflow a query string. Paging raised how many IDs a lookup can carry, and
 * a URL is the one part of this that fails without an error worth reading.
 */
function chunkIds(ids: string[], size = ID_CHUNK_SIZE): string[][] {
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += size) {
    chunks.push(ids.slice(i, i + size));
  }
  return chunks;
}

@Injectable()
export class ReportService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: SupabaseClient,
    @Inject(SEMESTER_ARCHIVE_REPOSITORY)
    private readonly semesterArchiveRepo: ISemesterArchiveRepository,
  ) {}

  /**
   * Attendance rows for a chapter, scoped by the event filters.
   *
   * The chapter and date filters are applied to the embedded `events` resource
   * with `!inner` rather than by first collecting event IDs and passing them
   * back as an `in` list. The two-step version could not be paged safely: a
   * chapter with more events than `max_rows` silently lost the overflow, and
   * lifting that cap would push thousands of UUIDs into a query string.
   *
   * `users` **must** name its foreign key. `event_attendance` reaches `users`
   * twice — `user_id` and `marked_by` — and a bare `users(...)` embed is
   * rejected by PostgREST as ambiguous (`PGRST201`), which failed this
   * endpoint in every environment (#746). `user_id` is the attendee; `marked_by`
   * is the officer who recorded them.
   */
  async getAttendanceReport(
    chapterId: string,
    input: AttendanceReportInput,
  ): Promise<ReportResult<AttendanceReportRow>> {
    const { rows: joined, truncated } =
      await fetchAllPages<AttendanceJoinedRow>((from, to) => {
        let query = this.supabase
          .from('event_attendance')
          .select(
            `
        id,
        status,
        check_in_time,
        event_id,
        events!inner (id, name, start_time),
        users!event_attendance_user_id_fkey (display_name)
      `,
          )
          .eq('events.chapter_id', chapterId);

        if (input.event_id) {
          query = query.eq('events.id', input.event_id);
        }
        if (input.start_date) {
          query = query.gte(
            'events.start_time',
            `${input.start_date}T00:00:00.000Z`,
          );
        }
        if (input.end_date) {
          query = query.lte(
            'events.start_time',
            `${input.end_date}T23:59:59.999Z`,
          );
        }

        return query
          .order('id', { ascending: true })
          .range(from, to) as PromiseLike<QueryResult<AttendanceJoinedRow>>;
      });

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
    return { rows, truncated };
  }

  async getPointsReport(
    chapterId: string,
    input: PointsReportInput,
  ): Promise<ReportResult<PointsReportRow>> {
    const window: PointsWindow = input.window ?? 'all';
    // Resolve the window's lower bound with the same helper the leaderboard uses
    // (points.service.ts) so report totals match the leaderboard for the same
    // window. Only the semester window needs the latest archive.
    let latestArchiveEndDate: string | null = null;
    if (window === 'semester') {
      const archive =
        await this.semesterArchiveRepo.findLatestByChapter(chapterId);
      latestArchiveEndDate = archive?.end_date ?? null;
    }
    const since = resolveWindowSince(window, {
      now: new Date(),
      latestArchiveEndDate,
    });

    // An RPC result set is subject to `max_rows` exactly like a table read, so
    // this pages too. `member_name` is the only orderable column the function
    // returns — it exposes no key — so two members sharing a display name
    // across a page boundary is an ordering tie this cannot break. That needs
    // >1000 members in one chapter to reach; carrying `user_id` out of the RPC
    // is tracked separately (#747).
    const { rows, truncated } = await fetchAllPages<PointsReportRpcRow>(
      (from, to) =>
        this.supabase
          .rpc('get_points_report', {
            p_chapter_id: chapterId,
            p_user_id: input.user_id || null,
            p_since: since ? since.toISOString() : null,
          })
          .order('member_name', { ascending: true })
          .range(from, to) as PromiseLike<QueryResult<PointsReportRpcRow>>,
    );

    return {
      rows: rows.map((row) => ({
        member_name: row.member_name,
        total_points: Number(row.total_points),
        breakdown_by_category: row.breakdown_by_category || {},
      })),
      truncated,
    };
  }

  async getRosterReport(
    chapterId: string,
  ): Promise<ReportResult<RosterReportRow>> {
    const { rows: members, truncated: membersTruncated } =
      await fetchAllPages<MemberRosterRow>((from, to) =>
        this.supabase
          .from('members')
          .select('id, user_id, role_ids, created_at')
          .eq('chapter_id', chapterId)
          .order('id', { ascending: true })
          .range(from, to),
      );
    if (!members.length) return { rows: [], truncated: membersTruncated };

    const userIds = members.map((m) => m.user_id);

    // ⚡ Bolt: Parallelize independent DB queries to eliminate sequential
    // network roundtrips. Expected impact: Reduces latency during roster
    // generation by fetching users and points transactions concurrently.
    const usersQuery = Promise.all(
      chunkIds(userIds).map(
        (ids) =>
          this.supabase
            .from('users')
            .select('id, display_name, email')
            .in('id', ids) as PromiseLike<QueryResult<UserRosterRow>>,
      ),
    );
    // Scoped by chapter alone, then matched against the roster in memory
    // below. Filtering on `user_id` as well would mean an `in` list holding
    // every member, chunked across a query that also has to page — for a
    // filter that changes nothing: a balance is only ever read back for a
    // member's own ID, so a departed member's residual rows are inert.
    const transactionsQuery = fetchAllPages<UserAmountRow>(
      (from, to) =>
        this.supabase
          .from('point_transactions')
          .select('id, user_id, amount')
          .eq('chapter_id', chapterId)
          .order('id', { ascending: true })
          .range(from, to),
      REPORT_AGGREGATE_MAX_ROWS,
    );

    const [userPages, transactions] = await Promise.all([
      usersQuery,
      transactionsQuery,
    ]);

    for (const pageResult of userPages) {
      throwIfError(pageResult.error);
    }

    const userMap = new Map(
      userPages.flatMap((pageResult) =>
        (pageResult.data ?? []).map(
          (u) =>
            [u.id, { display_name: u.display_name, email: u.email }] as const,
        ),
      ),
    );

    const balances = new Map<string, number>();
    for (const t of transactions.rows) {
      const uid = t.user_id;
      balances.set(uid, (balances.get(uid) ?? 0) + (t.amount ?? 0));
    }

    const roleIds = [...new Set(members.flatMap((m) => m.role_ids ?? []))];
    const roleMap = new Map<string, string>();
    if (roleIds.length > 0) {
      const rolePages = (await Promise.all(
        chunkIds(roleIds).map((ids) =>
          this.supabase
            .from('roles')
            .select('id, name')
            .eq('chapter_id', chapterId)
            .in('id', ids),
        ),
      )) as QueryResult<RoleNameRow>[];
      for (const pageResult of rolePages) {
        throwIfError(pageResult.error);
        for (const r of pageResult.data ?? []) {
          roleMap.set(r.id, r.name);
        }
      }
    }

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

    // A truncated transaction read is not a short roster — it is a roster of
    // the right length carrying *wrong* balances, which no row count reveals.
    // It counts as truncation so the report still declares itself incomplete.
    return { rows, truncated: membersTruncated || transactions.truncated };
  }

  async getServiceReport(
    chapterId: string,
    input: ServiceReportInput,
  ): Promise<ReportResult<ServiceReportRow>> {
    const { rows: entries, truncated } = await fetchAllPages<ServiceEntryRow>(
      (from, to) => {
        let query = this.supabase
          .from('service_entries')
          .select('id, user_id, date, duration_minutes, description, status')
          .eq('chapter_id', chapterId);

        if (input.user_id) {
          query = query.eq('user_id', input.user_id);
        }
        if (input.start_date) {
          query = query.gte('date', input.start_date);
        }
        if (input.end_date) {
          query = query.lte('date', input.end_date);
        }

        // `date` alone is not unique, so it cannot order a paged read on its
        // own — `id` breaks the ties that would otherwise duplicate or drop
        // entries sharing a date across a page boundary.
        return query
          .order('date', { ascending: false })
          .order('id', { ascending: true })
          .range(from, to) as PromiseLike<QueryResult<ServiceEntryRow>>;
      },
    );
    if (!entries.length) return { rows: [], truncated };

    const userIds = [...new Set(entries.map((e) => e.user_id))];
    const userPages = (await Promise.all(
      chunkIds(userIds).map((ids) =>
        this.supabase.from('users').select('id, display_name').in('id', ids),
      ),
    )) as QueryResult<UserNameRow>[];

    const userMap = new Map<string, string>();
    for (const pageResult of userPages) {
      throwIfError(pageResult.error);
      for (const u of pageResult.data ?? []) {
        userMap.set(u.id, u.display_name);
      }
    }

    const rows = entries.map((e) => ({
      member_name: userMap.get(e.user_id) ?? '',
      date: e.date,
      duration_minutes: e.duration_minutes,
      description: e.description,
      status: e.status,
    }));
    return { rows, truncated };
  }
}
