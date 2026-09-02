import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  REPORT_AGGREGATE_MAX_ROWS,
  REPORT_MAX_ROWS,
  ReportService,
} from './report.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

describe('ReportService', () => {
  let service: ReportService;
  let mockSupabase: jest.Mocked<Pick<FrappSupabaseClient, 'from' | 'rpc'>>;
  let mockSemesterArchiveRepo: {
    findLatestByChapter: jest.Mock;
    findById: jest.Mock;
  };

  /**
   * A PostgREST-shaped chain that honours `.range()` by actually slicing its
   * backing rows.
   *
   * This is load-bearing, not convenience: a mock that returns the same full
   * page for every `.range()` would either loop forever or make a paging bug
   * invisible. Slicing lets a test hand over more rows than one page and
   * assert the service assembled all of them. `ranges` records what was asked
   * for, so page boundaries can be asserted directly.
   */
  const makeChain = (resolveValue: {
    data: unknown[];
    error: unknown;
    /** Server-side `max_rows`: caps any one page, like PostgREST does. */
    maxRowsCap?: number;
  }) => {
    const chain: Record<string, unknown> = {};
    const ranges: [number, number][] = [];
    let slice: [number, number] | null = null;

    const settle = () => {
      if (resolveValue.error) return { data: null, error: resolveValue.error };
      const rows = resolveValue.data;
      if (!slice) return { data: rows, error: null };
      const page = rows.slice(slice[0], slice[1] + 1);
      return {
        data: resolveValue.maxRowsCap
          ? page.slice(0, resolveValue.maxRowsCap)
          : page,
        error: null,
      };
    };

    Object.assign(chain, {
      select: jest.fn().mockReturnValue(chain),
      eq: jest.fn().mockReturnValue(chain),
      in: jest.fn().mockReturnValue(chain),
      gte: jest.fn().mockReturnValue(chain),
      lte: jest.fn().mockReturnValue(chain),
      order: jest.fn().mockReturnValue(chain),
      range: jest.fn((from: number, to: number) => {
        slice = [from, to];
        ranges.push([from, to]);
        return chain;
      }),
      ranges,
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(settle()).then(resolve),
      catch: (fn: (e: unknown) => void) => Promise.reject().catch(fn),
    });
    return chain;
  };

  /** `n` distinct rows, so a paged read can be checked for drops and repeats. */
  const rows = (n: number, build: (i: number) => Record<string, unknown>) =>
    Array.from({ length: n }, (_, i) => build(i));

  beforeEach(async () => {
    mockSupabase = {
      from: jest
        .fn()
        .mockImplementation(() => makeChain({ data: [], error: null })),
      rpc: jest
        .fn()
        .mockImplementation(() => makeChain({ data: [], error: null })),
    };

    mockSemesterArchiveRepo = {
      findLatestByChapter: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: SUPABASE_CLIENT,
          useValue: mockSupabase,
        },
        {
          provide: SEMESTER_ARCHIVE_REPOSITORY,
          useValue: mockSemesterArchiveRepo,
        },
      ],
    }).compile();

    service = module.get(ReportService);
  });

  describe('getAttendanceReport', () => {
    it('should return attendance report data for event filter', async () => {
      const attChain = makeChain({
        data: [
          {
            status: 'PRESENT',
            check_in_time: '2026-02-26T10:00:00Z',
            event_id: 'ev-1',
            events: {
              id: 'ev-1',
              name: 'Meeting',
              start_time: '2026-02-26T10:00:00Z',
            },
            users: { display_name: 'John Doe' },
          },
        ],
        error: null,
      });

      (mockSupabase.from as jest.Mock).mockReturnValue(attChain);

      const result = await service.getAttendanceReport('ch-1', {
        event_id: 'ev-1',
      });

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({
        member_name: 'John Doe',
        event_name: 'Meeting',
        event_date: '2026-02-26',
        status: 'PRESENT',
        check_in_time: '2026-02-26T10:00:00Z',
      });
    });

    it('should return empty array when no events match', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: [], error: null }),
      );

      const result = await service.getAttendanceReport('ch-1', {
        start_date: '2025-01-01',
        end_date: '2025-01-31',
      });

      expect(result.rows).toEqual([]);
    });
  });

  describe('getPointsReport', () => {
    it('should return points report with breakdown by category', async () => {
      const rpcChain = makeChain({
        data: [
          {
            member_name: 'Jane',
            total_points: 15,
            breakdown_by_category: {
              ATTENDANCE: 10,
              SERVICE: 5,
            },
          },
        ],
        error: null,
      });

      (mockSupabase.rpc as jest.Mock).mockReturnValue(rpcChain);

      const result = await service.getPointsReport('ch-1', {});

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0].member_name).toBe('Jane');
      expect(result.rows[0].total_points).toBe(15);
      expect(result.rows[0].breakdown_by_category).toEqual({
        ATTENDANCE: 10,
        SERVICE: 5,
      });
    });

    it('should return empty array when no transactions', async () => {
      (mockSupabase.rpc as jest.Mock).mockReturnValue(
        makeChain({ data: [], error: null }),
      );

      const result = await service.getPointsReport('ch-1', {});

      expect(result.rows).toEqual([]);
    });

    it('passes p_since=null for the default (all-time) window', async () => {
      await service.getPointsReport('ch-1', {});

      expect(
        (mockSupabase.rpc as jest.Mock).mock.calls[0][1].p_since,
      ).toBeNull();
      expect(
        mockSemesterArchiveRepo.findLatestByChapter,
      ).not.toHaveBeenCalled();
    });

    it('passes p_since=null for an explicit all-time window', async () => {
      await service.getPointsReport('ch-1', { window: 'all' });

      expect(
        (mockSupabase.rpc as jest.Mock).mock.calls[0][1].p_since,
      ).toBeNull();
    });

    it('passes a trailing-month p_since for the month window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
      try {
        await service.getPointsReport('ch-1', { window: 'month' });
      } finally {
        jest.useRealTimers();
      }

      expect((mockSupabase.rpc as jest.Mock).mock.calls[0][1].p_since).toBe(
        '2026-05-15T12:00:00.000Z',
      );
      expect(
        mockSemesterArchiveRepo.findLatestByChapter,
      ).not.toHaveBeenCalled();
    });

    it('passes the archive end-of-day p_since for the semester window', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue({
        id: 'arch-1',
        chapter_id: 'ch-1',
        label: 'Spring 2026',
        start_date: '2026-01-01',
        end_date: '2026-05-15',
        created_at: '2026-05-16T00:00:00.000Z',
      });

      await service.getPointsReport('ch-1', { window: 'semester' });

      expect(mockSemesterArchiveRepo.findLatestByChapter).toHaveBeenCalledWith(
        'ch-1',
      );
      expect((mockSupabase.rpc as jest.Mock).mock.calls[0][1].p_since).toBe(
        '2026-05-15T23:59:59.999Z',
      );
    });

    it('passes p_since=null for the semester window when no archive exists', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue(null);

      await service.getPointsReport('ch-1', { window: 'semester' });

      expect(
        (mockSupabase.rpc as jest.Mock).mock.calls[0][1].p_since,
      ).toBeNull();
    });

    describe('semester_archive_id (#377)', () => {
      it('overrides `window` and passes the archive’s own [since, until] bounds', async () => {
        mockSemesterArchiveRepo.findById.mockResolvedValue({
          id: 'arch-1',
          chapter_id: 'ch-1',
          label: 'Spring 2026',
          start_date: '2026-01-15',
          end_date: '2026-05-15',
          created_at: '2026-05-16T00:00:00.000Z',
        });

        await service.getPointsReport('ch-1', {
          window: 'month', // must be ignored — the archive id wins
          semester_archive_id: 'arch-1',
        });

        expect(mockSemesterArchiveRepo.findById).toHaveBeenCalledWith(
          'arch-1',
          'ch-1',
        );
        expect(
          mockSemesterArchiveRepo.findLatestByChapter,
        ).not.toHaveBeenCalled();
        const call = (mockSupabase.rpc as jest.Mock).mock.calls[0][1];
        expect(call.p_since).toBe('2026-01-14T23:59:59.999Z');
        expect(call.p_until).toBe('2026-05-15T23:59:59.999Z');
      });

      it('passes p_until=null when no archive is selected', async () => {
        await service.getPointsReport('ch-1', {});

        expect(
          (mockSupabase.rpc as jest.Mock).mock.calls[0][1].p_until,
        ).toBeNull();
      });

      it('throws NotFoundException for an archive id that is unknown or belongs to another chapter', async () => {
        mockSemesterArchiveRepo.findById.mockResolvedValue(null);

        await expect(
          service.getPointsReport('ch-1', {
            semester_archive_id: 'not-a-real-id',
          }),
        ).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('getRosterReport', () => {
    it('should return roster with members, roles, and point balance', async () => {
      const membersChain = makeChain({
        data: [
          {
            user_id: 'u-1',
            role_ids: ['r-1'],
            created_at: '2026-01-15T00:00:00Z',
          },
        ],
        error: null,
      });
      const usersChain = makeChain({
        data: [
          {
            id: 'u-1',
            display_name: 'Alice',
            email: 'alice@test.com',
          },
        ],
        error: null,
      });
      const txnsChain = makeChain({
        data: [{ user_id: 'u-1', amount: 25 }],
        error: null,
      });
      const rolesChain = makeChain({
        data: [{ id: 'r-1', name: 'Member' }],
        error: null,
      });

      (mockSupabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'members') return membersChain;
        if (t === 'users') return usersChain;
        if (t === 'point_transactions') return txnsChain;
        return rolesChain;
      });

      const result = await service.getRosterReport('ch-1');

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({
        name: 'Alice',
        email: 'alice@test.com',
        roles: ['Member'],
        join_date: '2026-01-15',
        point_balance: 25,
      });
    });

    it('should return empty array when no members', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: [], error: null }),
      );

      const result = await service.getRosterReport('ch-1');

      expect(result.rows).toEqual([]);
    });
  });

  describe('getServiceReport', () => {
    it('should return service hours report data', async () => {
      const entriesChain = makeChain({
        data: [
          {
            user_id: 'u-1',
            date: '2026-02-20',
            duration_minutes: 120,
            description: 'Community service',
            status: 'APPROVED',
          },
        ],
        error: null,
      });
      const usersChain = makeChain({
        data: [{ id: 'u-1', display_name: 'Bob' }],
        error: null,
      });

      (mockSupabase.from as jest.Mock).mockImplementation((t: string) =>
        t === 'service_entries' ? entriesChain : usersChain,
      );

      const result = await service.getServiceReport('ch-1', {});

      expect(result.rows).toHaveLength(1);
      expect(result.rows[0]).toEqual({
        member_name: 'Bob',
        date: '2026-02-20',
        duration_minutes: 120,
        description: 'Community service',
        status: 'APPROVED',
      });
    });

    it('should return empty array when no service entries', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: [], error: null }),
      );

      const result = await service.getServiceReport('ch-1', {
        user_id: 'u-1',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
      });

      expect(result.rows).toEqual([]);
    });
  });

  describe('paging past PostgREST max_rows', () => {
    // `supabase/config.toml` caps a single PostgREST response at 1000 rows.
    // Before paging, every one of these reports stopped there without saying
    // so. Each test hands the mock more rows than one page and asserts the
    // whole set came back.
    const PAGE = 1000;

    const attendanceRow = (i: number) => ({
      id: `att-${String(i).padStart(6, '0')}`,
      status: 'PRESENT',
      check_in_time: null,
      event_id: 'ev-1',
      events: {
        id: 'ev-1',
        name: 'Meeting',
        start_time: '2026-02-26T10:00:00Z',
      },
      users: { display_name: `Member ${i}` },
    });

    it('assembles an attendance report larger than one page, dropping nothing', async () => {
      const chain = makeChain({
        data: rows(PAGE * 2 + 137, attendanceRow),
        error: null,
      });
      (mockSupabase.from as jest.Mock).mockReturnValue(chain);

      const result = await service.getAttendanceReport('ch-1', {});

      expect(result.rows).toHaveLength(PAGE * 2 + 137);
      expect(result.truncated).toBe(false);
      // Distinct members, so a duplicated or skipped page would show up here
      // even if the count happened to line up.
      expect(new Set(result.rows.map((r) => r.member_name)).size).toBe(
        PAGE * 2 + 137,
      );
      // Offsets advance by rows received, and the read ends on an empty page
      // rather than a short one.
      expect((chain as { ranges: [number, number][] }).ranges).toEqual([
        [0, 999],
        [1000, 1999],
        [2000, 2999],
        [2137, 3136],
      ]);
    });

    it('stops once a page comes back empty', async () => {
      const chain = makeChain({ data: rows(10, attendanceRow), error: null });
      (mockSupabase.from as jest.Mock).mockReturnValue(chain);

      await service.getAttendanceReport('ch-1', {});

      expect((chain as { ranges: [number, number][] }).ranges).toEqual([
        [0, 999],
        [10, 1009],
      ]);
    });

    it('reads every row when the server caps pages below the requested size', async () => {
      // `REPORT_PAGE_SIZE` is a request, not a promise about the server.
      // `supabase/config.toml` governs the local stack only — the hosted
      // project's Max rows is a dashboard setting this code cannot see — so a
      // server capping harder than expected must cost extra trips, never rows.
      // Treating a short page as "the data ran out" is what would silently
      // truncate here, with `truncated: false` attached to it.
      const chain = makeChain({
        data: rows(1200, attendanceRow),
        error: null,
        maxRowsCap: 300,
      });
      (mockSupabase.from as jest.Mock).mockReturnValue(chain);

      const result = await service.getAttendanceReport('ch-1', {});

      expect(result.rows).toHaveLength(1200);
      expect(result.truncated).toBe(false);
      expect(new Set(result.rows.map((r) => r.member_name)).size).toBe(1200);
    });

    it('assembles a service report larger than one page', async () => {
      const entries = makeChain({
        data: rows(PAGE + 1, (i) => ({
          id: `se-${i}`,
          user_id: 'u-1',
          date: '2026-02-20',
          duration_minutes: 60,
          description: `Entry ${i}`,
          status: 'APPROVED',
        })),
        error: null,
      });
      const users = makeChain({
        data: [{ id: 'u-1', display_name: 'Bob' }],
        error: null,
      });
      (mockSupabase.from as jest.Mock).mockImplementation((t: string) =>
        t === 'service_entries' ? entries : users,
      );

      const result = await service.getServiceReport('ch-1', {});

      expect(result.rows).toHaveLength(PAGE + 1);
      expect(result.truncated).toBe(false);
      expect(result.rows[PAGE].description).toBe(`Entry ${PAGE}`);
    });

    it('sums every page of point transactions into a roster balance', async () => {
      // The sharpest form of this bug: a truncated transaction read does not
      // shorten the roster, it makes every balance on it quietly wrong.
      const members = makeChain({
        data: [
          {
            id: 'm-1',
            user_id: 'u-1',
            role_ids: [],
            created_at: '2026-01-15T00:00:00Z',
          },
        ],
        error: null,
      });
      const users = makeChain({
        data: [{ id: 'u-1', display_name: 'Alice', email: 'a@test.com' }],
        error: null,
      });
      const txns = makeChain({
        data: rows(PAGE + 500, (i) => ({
          id: `pt-${i}`,
          user_id: 'u-1',
          amount: 1,
        })),
        error: null,
      });
      (mockSupabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'members') return members;
        if (t === 'users') return users;
        return txns;
      });

      const result = await service.getRosterReport('ch-1');

      // 1500, not 1000: the balance counts transactions past the first page.
      expect(result.rows[0].point_balance).toBe(PAGE + 500);
      expect(result.truncated).toBe(false);
    });
  });

  describe('the row ceiling', () => {
    const serviceRow = (i: number) => ({
      id: `se-${String(i).padStart(6, '0')}`,
      user_id: 'u-1',
      date: '2026-02-20',
      duration_minutes: 60,
      description: `Entry ${i}`,
      status: 'APPROVED',
    });

    const runService = async (total: number) => {
      const entries = makeChain({ data: rows(total, serviceRow), error: null });
      const users = makeChain({ data: [], error: null });
      (mockSupabase.from as jest.Mock).mockImplementation((t: string) =>
        t === 'service_entries' ? entries : users,
      );
      return service.getServiceReport('ch-1', {});
    };

    it('caps the rows and reports truncation past the ceiling', async () => {
      const result = await runService(REPORT_MAX_ROWS + 1);

      expect(result.rows).toHaveLength(REPORT_MAX_ROWS);
      expect(result.truncated).toBe(true);
    });

    it('does not call a report of exactly the ceiling truncated', async () => {
      // The off-by-one that would matter most: a complete report labelled
      // incomplete teaches officers to ignore the warning.
      const result = await runService(REPORT_MAX_ROWS);

      expect(result.rows).toHaveLength(REPORT_MAX_ROWS);
      expect(result.truncated).toBe(false);
    });
  });

  describe('the points RPC pages on the same terms as a table', () => {
    it('reads every member when the RPC spans pages', async () => {
      const rpcChain = makeChain({
        data: rows(1200, (i) => ({
          member_name: `Member ${String(i).padStart(5, '0')}`,
          total_points: 1,
          breakdown_by_category: {},
        })),
        error: null,
      });
      (mockSupabase.rpc as jest.Mock).mockReturnValue(rpcChain);

      const result = await service.getPointsReport('ch-1', {});

      expect(result.rows).toHaveLength(1200);
      expect(new Set(result.rows.map((r) => r.member_name)).size).toBe(1200);
    });

    it('reads every member when the server caps RPC pages below the request', async () => {
      // The RPC pays a redundant aggregation on its terminating page rather
      // than ending on a short one, precisely so this case reads correctly
      // instead of stopping at the cap and calling itself complete.
      const rpcChain = makeChain({
        data: rows(1200, (i) => ({
          member_name: `Member ${String(i).padStart(5, '0')}`,
          total_points: 1,
          breakdown_by_category: {},
        })),
        error: null,
        maxRowsCap: 200,
      });
      (mockSupabase.rpc as jest.Mock).mockReturnValue(rpcChain);

      const result = await service.getPointsReport('ch-1', {});

      expect(result.rows).toHaveLength(1200);
      expect(result.truncated).toBe(false);
      expect(new Set(result.rows.map((r) => r.member_name)).size).toBe(1200);
    });
  });

  describe('roster balances truncated by the aggregate ceiling', () => {
    it('reports its own ceiling and names the balances, not the row count', async () => {
      // The roster is complete at one line; only the balances are wrong.
      // Reporting REPORT_MAX_ROWS here would print "capped at the first 5,000
      // rows" on a 1-row document, which reads as a false positive and sends
      // the reader hunting for missing members instead of distrusting the
      // numbers.
      const members = makeChain({
        data: [
          { user_id: 'u-1', role_ids: [], created_at: '2026-01-15T00:00:00Z' },
        ],
        error: null,
      });
      const users = makeChain({
        data: [{ id: 'u-1', display_name: 'Alice', email: 'a@test.com' }],
        error: null,
      });
      const txns = makeChain({
        data: rows(REPORT_AGGREGATE_MAX_ROWS + 1, () => ({
          user_id: 'u-1',
          amount: 1,
        })),
        error: null,
      });
      (mockSupabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'members') return members;
        if (t === 'users') return users;
        if (t === 'point_transactions') return txns;
        return makeChain({ data: [], error: null });
      });

      const result = await service.getRosterReport('ch-1');

      expect(result.rows).toHaveLength(1);
      expect(result.truncated).toBe(true);
      expect(result.limit).toBe(REPORT_AGGREGATE_MAX_ROWS);
      expect(result.note).toContain('point balances are incomplete');
    });

    it('reports both cuts when the roster and the balances are each truncated', async () => {
      // Reporting only the aggregate ceiling would leave the roster's own cut
      // unmentioned, and hand back a limit the row count never reached.
      const members = makeChain({
        data: rows(REPORT_MAX_ROWS + 1, (i) => ({
          user_id: `u-${i}`,
          role_ids: [],
          created_at: '2026-01-15T00:00:00Z',
        })),
        error: null,
      });
      const txns = makeChain({
        data: rows(REPORT_AGGREGATE_MAX_ROWS + 1, () => ({
          user_id: 'u-0',
          amount: 1,
        })),
        error: null,
      });
      (mockSupabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'members') return members;
        if (t === 'point_transactions') return txns;
        return makeChain({ data: [], error: null });
      });

      const result = await service.getRosterReport('ch-1');

      expect(result.rows).toHaveLength(REPORT_MAX_ROWS);
      expect(result.truncated).toBe(true);
      expect(result.limit).toBe(REPORT_MAX_ROWS);
      expect(result.note).toContain('roster capped at');
      expect(result.note).toContain('point balances are incomplete');
    });
  });

  describe('the attendance query contract', () => {
    it('names the user_id foreign key so the users embed is unambiguous', async () => {
      // Regression for #746: `event_attendance` reaches `users` through both
      // `user_id` and `marked_by`, so a bare `users(...)` embed is rejected by
      // PostgREST with PGRST201 and the endpoint 500s in every environment.
      // The mock cannot reproduce that, so the select string itself is pinned.
      const chain = makeChain({ data: [], error: null });
      (mockSupabase.from as jest.Mock).mockReturnValue(chain);

      await service.getAttendanceReport('ch-1', {});

      const select = (chain.select as jest.Mock).mock.calls[0][0] as string;
      expect(select).toContain('users!event_attendance_user_id_fkey');
      expect(select).not.toMatch(/(^|[^!_])\busers\s*\(/);
      // The chapter filter rides on the embedded events resource, which only
      // constrains the parent rows when the join is inner.
      expect(select).toContain('events!inner');
      expect(chain.eq as jest.Mock).toHaveBeenCalledWith(
        'events.chapter_id',
        'ch-1',
      );
    });

    it('filters dates on the embedded event, not the attendance row', async () => {
      const chain = makeChain({ data: [], error: null });
      (mockSupabase.from as jest.Mock).mockReturnValue(chain);

      await service.getAttendanceReport('ch-1', {
        start_date: '2026-01-01',
        end_date: '2026-05-31',
      });

      expect(chain.gte as jest.Mock).toHaveBeenCalledWith(
        'events.start_time',
        '2026-01-01T00:00:00.000Z',
      );
      expect(chain.lte as jest.Mock).toHaveBeenCalledWith(
        'events.start_time',
        '2026-05-31T23:59:59.999Z',
      );
    });
  });
});
