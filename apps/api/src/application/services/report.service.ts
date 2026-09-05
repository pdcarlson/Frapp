import { Inject, Injectable } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import {
  resolveWindowSince,
  type PointsWindow,
} from '../../domain/utils/points-window';
import { resolveSemesterArchiveRangeOrThrow } from './resolve-semester-archive-range';
import { chunkIds } from '../../domain/utils/chunk-ids';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

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

interface QueryError {
  message: string;
}

interface QueryResult<T> {
  data: T[] | null;
  error: QueryError | null;
}

/**
 * Rows requested per round-trip.
 *
 * This is a request size, not an assumption about the server's cap. The loop
 * advances by however many rows actually came back, so a server whose
 * `max_rows` is lower than this still reads correctly — it just takes more
 * trips. That matters because `supabase/config.toml` governs the *local*
 * stack only; the hosted project's "Max rows" is a dashboard setting this file
 * cannot see. `scheduled-jobs.repository.ts` reaches the same conclusion from
 * the other direction, by holding its page size deliberately below the cap.
 */
const REPORT_PAGE_SIZE = 1000;

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
 * 50 round-trips (~1.2 s by the measurement in the perf notes), plus the one
 * terminating empty request `fetchAllPages` always pays, before any rendering
 * starts. That arithmetic is unchanged by #567 — what changed is how many rows
 * it takes to get there.
 *
 * **It counts members, not transactions (#567).** Balances come from
 * `get_roster_point_balances`, which groups by `user_id` and emits one row per
 * member with any transaction, so this bound scales with roster size and is
 * independent of chapter history. It used to bound the *transaction* stream
 * this replaced, where an active chapter could cross it in a semester and the
 * export would then report wrong balances behind a footnote. At one row per
 * member the ceiling is no longer a cliff anyone reaches; it stays because the
 * bound is still real, not because it is expected to fire.
 */
export const REPORT_AGGREGATE_MAX_ROWS = 50_000;

// `ID_CHUNK_SIZE` and `chunkIds` moved to `domain/utils/chunk-ids` so the
// narrow user-display lookup can share the same measured bound (#1000). The
// rationale for the number lives with them.

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

interface AttendanceJoinedRow {
  status: string;
  check_in_time: string | null;
  events: { id: string; name: string; start_time: string } | null;
  users: { display_name: string } | null;
}

interface UserNameRow {
  id: string;
  display_name: string;
}

interface MemberRosterRow {
  user_id: string;
  role_ids: string[];
  created_at: string;
}

interface UserRosterRow {
  id: string;
  display_name: string;
  email: string;
}

/**
 * One member's whole balance, already summed by `get_roster_point_balances`
 * (`20260905100000`). This replaced a `{ user_id, amount }` row per
 * *transaction*: the roster used to stream those in and reduce them in Node.
 */
interface RosterBalanceRow {
  user_id: string;
  /** `bigint` in SQL; PostgREST serializes it as a JSON number. */
  total_points: number;
}

interface RoleNameRow {
  id: string;
  name: string;
}

interface ServiceEntryRow {
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
 * `id`, which is selected for ordering but need not be projected. Offset
 * paging over a non-unique sort key has no guaranteed order between
 * statements, so rows sharing a sort value across a page boundary can come
 * back twice or vanish entirely.
 *
 * A total order rules out *that* shuffling; it does not make the read a
 * snapshot. These are separate statements, so a row inserted or deleted
 * between two pages still shifts the window and can duplicate or skip one row
 * at the boundary. Reports are point-in-time summaries rather than ledgers, so
 * that is accepted rather than solved — a keyset cursor would be the fix if it
 * ever stops being.
 *
 * One row past the ceiling is requested so `truncated` is an observed fact
 * rather than an inference from a full final page: a result of exactly
 * `REPORT_MAX_ROWS` rows is complete, not short, and must not be labelled as
 * truncated.
 */
async function fetchAllPages<T>(
  page: (from: number, to: number) => PromiseLike<QueryResult<T>>,
  { limit = REPORT_MAX_ROWS }: { limit?: number } = {},
): Promise<ReportResult<T>> {
  const readLimit = limit + 1;
  const rows: T[] = [];

  for (let from = 0; from < readLimit;) {
    const to = Math.min(from + REPORT_PAGE_SIZE, readLimit) - 1;
    const { data, error } = await page(from, to);
    throwIfError(error);

    const batch = data ?? [];
    rows.push(...batch);
    // Only an empty page proves the rows ran out. Treating any *short* page as
    // the end would silently truncate the moment the server's `max_rows` sits
    // below `REPORT_PAGE_SIZE` — the caller would ask for 1000, be handed the
    // cap, and read that as "no more rows", reinstating the exact bug this
    // paging exists to close, with `truncated: false` attached to it.
    // The cost of that guarantee is one extra, empty request per report once
    // the rows run out. A report is an admin-initiated action already costing
    // hundreds of milliseconds, so a round-trip is a cheap price for not
    // having to be right about a server setting this file cannot read.
    if (batch.length === 0) break;
    // Advance by what arrived, never by what was asked for: if the server
    // capped the page, the un-returned tail of the requested window has not
    // been read yet and stepping over it would drop those rows outright.
    from += batch.length;
  }

  const truncated = rows.length > limit;
  return {
    rows: truncated ? rows.slice(0, limit) : rows,
    truncated,
    limit,
  };
}

@Injectable()
export class ReportService {
  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
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
        status,
        check_in_time,
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

    // An RPC result set is subject to `max_rows` exactly like a table read, so
    // this pages too — and on the same terms, deliberately. PostgREST applies
    // `LIMIT`/`OFFSET` *outside* the function call, so the trailing empty
    // request re-runs `get_points_report` in full rather than costing an
    // indexed scan of nothing: one redundant `GROUP BY` per points report.
    // That is accepted. Ending on a short page instead would make this read —
    // alone among them — silently truncate whenever the server's `max_rows`
    // sat below the page size, which is the precise failure this branch
    // exists to remove, traded away for a few milliseconds on an admin action
    // nobody runs in a loop.
    //
    // `member_name` is also the only orderable column the function returns —
    // it exposes no key — so two members sharing a display name across a page
    // boundary is an ordering tie this cannot break. Reaching that needs more
    // members in one chapter than a page holds; carrying `user_id` out of the
    // RPC is tracked separately (#747).
    const { rows, truncated } = await fetchAllPages<PointsReportRpcRow>(
      (from, to) =>
        this.supabase
          .rpc('get_points_report', {
            p_chapter_id: chapterId,
            p_user_id: input.user_id || null,
            p_since: since ? since.toISOString() : null,
            p_until: until ? until.toISOString() : null,
          })
          .order('member_name', { ascending: true })
          .range(from, to),
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
      await fetchAllPages<MemberRosterRow>((from, to) =>
        this.supabase
          .from('members')
          .select('user_id, role_ids, created_at')
          .eq('chapter_id', chapterId)
          .order('id', { ascending: true })
          .range(from, to),
      );
    if (!members.length)
      return { rows: [], truncated: membersTruncated, limit: REPORT_MAX_ROWS };

    const userIds = members.map((m) => m.user_id);

    // ⚡ Bolt: Parallelize independent DB queries to eliminate sequential
    // network roundtrips. Expected impact: Reduces latency during roster
    // generation by fetching users and point balances concurrently.
    const usersQuery = Promise.all(
      chunkIds(userIds).map(
        (ids) =>
          this.supabase
            .from('users')
            .select('id, display_name, email')
            .in('id', ids) as PromiseLike<QueryResult<UserRosterRow>>,
      ),
    );
    // Summed by Postgres, one row per member, rather than streamed in as one
    // row per transaction (#567). Scoped by chapter alone, then matched
    // against the roster in memory below. Filtering on `user_id` as well would
    // mean an `in` list holding every member — for a filter that changes
    // nothing: a balance is only ever read back for a member's own ID, so a
    // departed member's residual rows are inert.
    //
    // Still paged, on the same terms as `getPointsReport` above: PostgREST
    // applies `max_rows` to an RPC result set exactly as to a table read. The
    // order is on `user_id`, which `get_roster_point_balances` groups by and
    // is therefore unique across the result — a total order, so no *tie* can
    // duplicate or drop a row across a page boundary. (`get_points_report`
    // cannot do this: it returns no key and can only tie-break on display
    // name, which is the whole of #747.)
    //
    // A total order is not a snapshot, and does not claim to be: a paged read
    // is several statements, so a concurrent write can still shift a boundary
    // (`fetchAllPages`' own docstring says so). That is the report-wide caveat
    // in the perf notes, not something this ordering fixes.
    //
    // What DID change is the shape of that rare failure, and it cuts both
    // ways. A row inserted between pages used to double-count one transaction;
    // now a duplicated aggregate row just rewrites the Map with the same value,
    // which is harmless. But a delete that removes a member's whole group no
    // longer shaves one transaction off their balance — it drops the group, and
    // they render as 0. Both need a chapter past one page of scoring members
    // plus a concurrent write mid-report.
    const balancesQuery = fetchAllPages<RosterBalanceRow>(
      (from, to) =>
        this.supabase
          .rpc('get_roster_point_balances', { p_chapter_id: chapterId })
          .order('user_id', { ascending: true })
          .range(from, to),
      { limit: REPORT_AGGREGATE_MAX_ROWS },
    );

    const [userPages, balanceRows] = await Promise.all([
      usersQuery,
      balancesQuery,
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

    // One row per member now, so this is a lookup table rather than a
    // reduction. `Number(...)` because the SQL type is `bigint`: PostgREST
    // serializes it as a JSON number, but the same cast guards the string form
    // some drivers hand back for 64-bit integers.
    //
    // `?? 0` keeps the nullish guard the per-transaction sum had. The function
    // coalesces, so a null total should be unreachable — but `Number(undefined)`
    // is `NaN`, and a NaN balance does not throw: it renders as "NaN" in the
    // PDF and CSV an officer downloads. A wrong number that announces itself as
    // wrong is still worse than a zero here, and neither is worth the risk of
    // relying on a shape this file does not own.
    const balances = new Map<string, number>(
      balanceRows.rows.map((b) => [b.user_id, Number(b.total_points ?? 0)]),
    );

    // Every role the chapter defines, rather than the subset the roster
    // mentions: `roles` is already chapter-scoped and a chapter holds a
    // handful of them, so filtering by ID bought nothing but an `in (...)`
    // list long enough to need chunking. Unmatched entries in the map are
    // inert — it is only ever read by a member's own `role_ids`.
    const roleMap = new Map<string, string>();
    const { rows: roles } = await fetchAllPages<RoleNameRow>((from, to) =>
      this.supabase
        .from('roles')
        .select('id, name')
        .eq('chapter_id', chapterId)
        .order('id', { ascending: true })
        .range(from, to),
    );
    for (const r of roles) {
      roleMap.set(r.id, r.name);
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

    // A truncated balance read is not a short roster — it is a roster of the
    // right length carrying *wrong* balances, which no row count reveals. It
    // counts as truncation so the report still declares itself incomplete, but
    // it reports its own ceiling and says which field is wrong: labelling a
    // complete 300-line roster "capped at 5,000 rows" reads as a false
    // positive, and the reader goes looking for missing members instead of
    // distrusting the balances.
    //
    // THE CEILING NOW COUNTS MEMBERS, NOT TRANSACTIONS, which is the point of
    // #567. `get_roster_point_balances` emits one row per member with any
    // transaction, so reaching 50,000 needs a 50,000-member chapter rather
    // than a 50,000-transaction one — the difference between a bound no real
    // chapter approaches and one an active chapter crosses in a semester. The
    // branch stays because the bound is still real, not because it is expected
    // to fire.
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
    const { rows: entries, truncated } = await fetchAllPages<ServiceEntryRow>(
      (from, to) => {
        let query = this.supabase
          .from('service_entries')
          .select('user_id, date, duration_minutes, description, status')
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
          .range(from, to);
      },
    );
    if (!entries.length) return { rows: [], truncated, limit: REPORT_MAX_ROWS };

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
    return { rows, truncated, limit: REPORT_MAX_ROWS };
  }
}
