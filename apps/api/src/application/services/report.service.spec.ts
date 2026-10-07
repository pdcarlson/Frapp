import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import {
  REPORT_AGGREGATE_MAX_ROWS,
  REPORT_MAX_ROWS,
  ReportService,
} from './report.service';
import {
  REPORT_REPOSITORY,
  type CappedRows,
  type IReportRepository,
} from '#domain/repositories/report.repository.interface';
import { SEMESTER_ARCHIVE_REPOSITORY } from '#domain/repositories/semester-archive.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';

/**
 * `ReportService` turns the repository's rows into reports. Paging, the
 * one-past-the-ceiling read that makes `truncated` observed, and the query
 * contracts (#746, #567, #1743) are `SupabaseReportRepository`'s and are pinned
 * in `supabase-report.repository.spec.ts`.
 */
describe('ReportService', () => {
  let service: ReportService;
  let repo: { [K in keyof IReportRepository]: jest.Mock };
  let users: { findDisplayIdentitiesByIds: jest.Mock };
  let mockSemesterArchiveRepo: {
    findLatestByChapter: jest.Mock;
    findById: jest.Mock;
  };

  const complete = <T>(rows: T[]): CappedRows<T> => ({
    rows,
    truncated: false,
  });

  /** `n` distinct rows. */
  const rows = <T>(n: number, build: (i: number) => T): T[] =>
    Array.from({ length: n }, (_, i) => build(i));

  /** The points filters the service handed the repository on its first call. */
  const pointsFilters = () =>
    repo.findPointsTotals.mock.calls[0][1] as {
      userId: string | null;
      since: Date | null;
      until: Date | null;
    };

  beforeEach(async () => {
    repo = {
      findAttendance: jest.fn().mockResolvedValue(complete([])),
      findPointsTotals: jest.fn().mockResolvedValue(complete([])),
      findRosterMembers: jest.fn().mockResolvedValue(complete([])),
      findMemberBalances: jest.fn().mockResolvedValue(complete([])),
      findRoleNames: jest.fn().mockResolvedValue([]),
      findServiceEntries: jest.fn().mockResolvedValue(complete([])),
      findUserContacts: jest.fn().mockResolvedValue([]),
    };

    users = { findDisplayIdentitiesByIds: jest.fn().mockResolvedValue([]) };

    mockSemesterArchiveRepo = {
      findLatestByChapter: jest.fn().mockResolvedValue(null),
      findById: jest.fn().mockResolvedValue(null),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        { provide: REPORT_REPOSITORY, useValue: repo },
        {
          provide: SEMESTER_ARCHIVE_REPOSITORY,
          useValue: mockSemesterArchiveRepo,
        },
        { provide: USER_REPOSITORY, useValue: users },
      ],
    }).compile();

    service = module.get(ReportService);
  });

  describe('getAttendanceReport', () => {
    it('should return attendance report data for event filter', async () => {
      repo.findAttendance.mockResolvedValue(
        complete([
          {
            status: 'PRESENT',
            check_in_time: '2026-02-26T10:00:00Z',
            events: {
              id: 'ev-1',
              name: 'Meeting',
              start_time: '2026-02-26T10:00:00Z',
            },
            users: { display_name: 'John Doe' },
          },
        ]),
      );

      const result = await service.getAttendanceReport('ch-1', {
        event_id: 'ev-1',
      });

      expect(repo.findAttendance).toHaveBeenCalledWith(
        'ch-1',
        { eventId: 'ev-1', startDate: undefined, endDate: undefined },
        REPORT_MAX_ROWS,
      );
      expect(result.rows).toEqual([
        {
          member_name: 'John Doe',
          event_name: 'Meeting',
          event_date: '2026-02-26',
          status: 'PRESENT',
          check_in_time: '2026-02-26T10:00:00Z',
        },
      ]);
    });

    it('forwards the date range to the read', async () => {
      await service.getAttendanceReport('ch-1', {
        start_date: '2025-01-01',
        end_date: '2025-01-31',
      });

      expect(repo.findAttendance).toHaveBeenCalledWith(
        'ch-1',
        { eventId: undefined, startDate: '2025-01-01', endDate: '2025-01-31' },
        REPORT_MAX_ROWS,
      );
    });

    it('orders rows by event date, then member name', async () => {
      const row = (name: string, start: string) => ({
        status: 'PRESENT',
        check_in_time: null,
        events: { id: 'ev', name: 'Meeting', start_time: start },
        users: { display_name: name },
      });
      repo.findAttendance.mockResolvedValue(
        complete([
          row('Zed', '2026-02-26T10:00:00Z'),
          row('Amy', '2026-02-27T10:00:00Z'),
          row('Bea', '2026-02-26T10:00:00Z'),
        ]),
      );

      const result = await service.getAttendanceReport('ch-1', {});

      expect(result.rows.map((r) => r.member_name)).toEqual([
        'Bea',
        'Zed',
        'Amy',
      ]);
    });

    it('carries the read’s truncation out with the row ceiling', async () => {
      repo.findAttendance.mockResolvedValue({ rows: [], truncated: true });

      const result = await service.getAttendanceReport('ch-1', {});

      expect(result).toEqual({
        rows: [],
        truncated: true,
        limit: REPORT_MAX_ROWS,
      });
    });
  });

  describe('getPointsReport', () => {
    it('should return points report with breakdown by category', async () => {
      repo.findPointsTotals.mockResolvedValue(
        complete([
          {
            member_name: 'Jane',
            total_points: 15,
            breakdown_by_category: { ATTENDANCE: 10, SERVICE: 5 },
          },
        ]),
      );

      const result = await service.getPointsReport('ch-1', {});

      expect(result.rows).toEqual([
        {
          member_name: 'Jane',
          total_points: 15,
          breakdown_by_category: { ATTENDANCE: 10, SERVICE: 5 },
        },
      ]);
      expect(repo.findPointsTotals.mock.calls[0][2]).toBe(REPORT_MAX_ROWS);
    });

    it('coerces a bigint total and fills a missing breakdown', async () => {
      repo.findPointsTotals.mockResolvedValue(
        complete([
          {
            member_name: 'Jane',
            total_points: '1234',
            breakdown_by_category: null,
          },
        ]),
      );

      const result = await service.getPointsReport('ch-1', {});

      expect(result.rows[0].total_points).toBe(1234);
      expect(result.rows[0].breakdown_by_category).toEqual({});
    });

    it('should return empty array when no transactions', async () => {
      const result = await service.getPointsReport('ch-1', {});

      expect(result.rows).toEqual([]);
    });

    it('scopes to one member when a user_id is given, and to none otherwise', async () => {
      await service.getPointsReport('ch-1', { user_id: 'u-1' });
      await service.getPointsReport('ch-1', { user_id: '' });

      expect(repo.findPointsTotals.mock.calls[0][1].userId).toBe('u-1');
      expect(repo.findPointsTotals.mock.calls[1][1].userId).toBeNull();
    });

    it('passes since=null for the default (all-time) window', async () => {
      await service.getPointsReport('ch-1', {});

      expect(pointsFilters().since).toBeNull();
      expect(
        mockSemesterArchiveRepo.findLatestByChapter,
      ).not.toHaveBeenCalled();
    });

    it('passes since=null for an explicit all-time window', async () => {
      await service.getPointsReport('ch-1', { window: 'all' });

      expect(pointsFilters().since).toBeNull();
    });

    it('passes a trailing-month since for the month window', async () => {
      jest.useFakeTimers().setSystemTime(new Date('2026-06-15T12:00:00.000Z'));
      try {
        await service.getPointsReport('ch-1', { window: 'month' });
      } finally {
        jest.useRealTimers();
      }

      expect(pointsFilters().since?.toISOString()).toBe(
        '2026-05-15T12:00:00.000Z',
      );
      expect(
        mockSemesterArchiveRepo.findLatestByChapter,
      ).not.toHaveBeenCalled();
    });

    it('passes the archive end-of-day since for the semester window', async () => {
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
      expect(pointsFilters().since?.toISOString()).toBe(
        '2026-05-15T23:59:59.999Z',
      );
    });

    it('passes since=null for the semester window when no archive exists', async () => {
      mockSemesterArchiveRepo.findLatestByChapter.mockResolvedValue(null);

      await service.getPointsReport('ch-1', { window: 'semester' });

      expect(pointsFilters().since).toBeNull();
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
        expect(pointsFilters().since?.toISOString()).toBe(
          '2026-01-14T23:59:59.999Z',
        );
        expect(pointsFilters().until?.toISOString()).toBe(
          '2026-05-15T23:59:59.999Z',
        );
      });

      it('passes until=null when no archive is selected', async () => {
        await service.getPointsReport('ch-1', {});

        expect(pointsFilters().until).toBeNull();
      });

      it('throws NotFoundException for an archive id that is unknown or belongs to another chapter', async () => {
        mockSemesterArchiveRepo.findById.mockResolvedValue(null);

        await expect(
          service.getPointsReport('ch-1', {
            semester_archive_id: 'not-a-real-id',
          }),
        ).rejects.toThrow(NotFoundException);
        expect(repo.findPointsTotals).not.toHaveBeenCalled();
      });
    });
  });

  describe('getRosterReport', () => {
    const member = (userId: string, roleIds: string[] = []) => ({
      user_id: userId,
      role_ids: roleIds,
      created_at: '2026-01-15T00:00:00Z',
    });

    it('should return roster with members, roles, and point balance', async () => {
      repo.findRosterMembers.mockResolvedValue(
        complete([member('u-1', ['r-1'])]),
      );
      repo.findUserContacts.mockResolvedValue([
        { id: 'u-1', display_name: 'Alice', email: 'alice@test.com' },
      ]);
      repo.findMemberBalances.mockResolvedValue(
        complete([{ user_id: 'u-1', total: 25 }]),
      );
      repo.findRoleNames.mockResolvedValue([{ id: 'r-1', name: 'Member' }]);

      const result = await service.getRosterReport('ch-1');

      expect(result.rows).toEqual([
        {
          name: 'Alice',
          email: 'alice@test.com',
          roles: ['Member'],
          join_date: '2026-01-15',
          point_balance: 25,
        },
      ]);
      expect(repo.findRosterMembers).toHaveBeenCalledWith(
        'ch-1',
        REPORT_MAX_ROWS,
      );
      expect(repo.findUserContacts).toHaveBeenCalledWith(['u-1']);
      expect(repo.findMemberBalances).toHaveBeenCalledWith(
        'ch-1',
        REPORT_AGGREGATE_MAX_ROWS,
      );
    });

    it('falls back to the raw id for a role the chapter no longer defines', async () => {
      repo.findRosterMembers.mockResolvedValue(
        complete([member('u-1', ['r-gone'])]),
      );

      const result = await service.getRosterReport('ch-1');

      expect(result.rows[0].roles).toEqual(['r-gone']);
    });

    it('gives a member with no transactions a zero balance, not a missing one', async () => {
      // The aggregate emits no row for a member who has never scored, so the
      // `?? 0` fallback is the only thing between them and `undefined` in the
      // rendered document.
      repo.findRosterMembers.mockResolvedValue(
        complete([member('u-1'), member('u-2')]),
      );
      repo.findMemberBalances.mockResolvedValue(
        complete([{ user_id: 'u-1', total: 9 }]),
      );

      const result = await service.getRosterReport('ch-1');

      expect(result.rows.map((r) => r.point_balance)).toEqual([9, 0]);
    });

    it('joins balances by user_id, not by row position', async () => {
      // The aggregate comes back in a different order than the roster (it is
      // ordered by `user_id`, the roster by `members.id`), and it carries a
      // row for a departed member who is no longer on the roster — which is
      // only inert if the lookup is by key.
      repo.findRosterMembers.mockResolvedValue(
        complete([member('u-b'), member('u-a')]),
      );
      repo.findUserContacts.mockResolvedValue([
        { id: 'u-a', display_name: 'Alice', email: 'a@t.com' },
        { id: 'u-b', display_name: 'Bob', email: 'b@t.com' },
      ]);
      repo.findMemberBalances.mockResolvedValue(
        complete([
          { user_id: 'u-a', total: 10 },
          // A member removed from the chapter keeps ledger rows, so the
          // aggregate still emits them. They must not land on anyone.
          { user_id: 'u-gone', total: 999 },
          { user_id: 'u-b', total: 20 },
        ]),
      );

      const result = await service.getRosterReport('ch-1');

      // Roster order is Bob then Alice; balance order is Alice, departed, Bob.
      // A positional zip would give Bob 10 and Alice 999.
      expect(result.rows.map((r) => [r.name, r.point_balance])).toEqual([
        ['Bob', 20],
        ['Alice', 10],
      ]);
      expect(result.rows.some((r) => r.point_balance === 999)).toBe(false);
    });

    it('coerces a bigint balance handed back as a string', async () => {
      // `total` is `bigint`. PostgREST serializes it as a JSON number,
      // but 64-bit integers are the classic case where a driver hands back a
      // string instead — and string concatenation would silently produce
      // nonsense totals rather than an error.
      repo.findRosterMembers.mockResolvedValue(complete([member('u-1')]));
      repo.findMemberBalances.mockResolvedValue(
        complete([{ user_id: 'u-1', total: '1234' }]),
      );

      const result = await service.getRosterReport('ch-1');

      expect(result.rows[0].point_balance).toBe(1234);
    });

    it('should return empty array when no members, without the follow-up reads', async () => {
      const result = await service.getRosterReport('ch-1');

      expect(result.rows).toEqual([]);
      expect(repo.findUserContacts).not.toHaveBeenCalled();
      expect(repo.findMemberBalances).not.toHaveBeenCalled();
    });

    describe('balances truncated by the aggregate ceiling', () => {
      // Post-#567 the ceiling counts SCORING MEMBERS, not transactions: the
      // aggregate emits one row per member holding any transaction.
      it('reports its own ceiling and names the balances, not the row count', async () => {
        // The roster is complete at one line; only the balances are wrong.
        // Reporting REPORT_MAX_ROWS here would print "capped at the first 5,000
        // rows" on a 1-row document, which reads as a false positive and sends
        // the reader hunting for missing members instead of distrusting the
        // numbers.
        repo.findRosterMembers.mockResolvedValue(complete([member('u-1')]));
        repo.findMemberBalances.mockResolvedValue({
          rows: [{ user_id: 'u-1', total: 1 }],
          truncated: true,
        });

        const result = await service.getRosterReport('ch-1');

        expect(result.rows).toHaveLength(1);
        expect(result.truncated).toBe(true);
        expect(result.limit).toBe(REPORT_AGGREGATE_MAX_ROWS);
        expect(result.note).toContain('point balances are incomplete');
        // The note has to name what the ceiling actually counts now, or it
        // sends the reader looking at transaction volume for a members-shaped
        // bound.
        expect(result.note).toContain('members');
        expect(result.note).not.toContain('transactions');
      });

      it('reports both cuts when the roster and the balances are each truncated', async () => {
        // Reporting only the aggregate ceiling would leave the roster's own cut
        // unmentioned, and hand back a limit the row count never reached.
        repo.findRosterMembers.mockResolvedValue({
          rows: rows(3, (i) => member(`u-${i}`)),
          truncated: true,
        });
        repo.findMemberBalances.mockResolvedValue({
          rows: [],
          truncated: true,
        });

        const result = await service.getRosterReport('ch-1');

        expect(result.truncated).toBe(true);
        expect(result.limit).toBe(REPORT_MAX_ROWS);
        expect(result.note).toContain('roster capped at');
        expect(result.note).toContain('point balances are incomplete');
      });

      it('reports a roster cut alone with the row ceiling and no note', async () => {
        repo.findRosterMembers.mockResolvedValue({
          rows: [member('u-1')],
          truncated: true,
        });

        const result = await service.getRosterReport('ch-1');

        expect(result).toMatchObject({
          truncated: true,
          limit: REPORT_MAX_ROWS,
        });
        expect(result.note).toBeUndefined();
      });
    });
  });

  describe('getServiceReport', () => {
    const entry = (userId: string, description: string) => ({
      user_id: userId,
      date: '2026-02-20',
      duration_minutes: 120,
      description,
      status: 'APPROVED',
    });

    it('should return service hours report data', async () => {
      repo.findServiceEntries.mockResolvedValue(
        complete([entry('u-1', 'Community service')]),
      );
      users.findDisplayIdentitiesByIds.mockResolvedValue([
        { id: 'u-1', display_name: 'Bob' },
      ]);

      const result = await service.getServiceReport('ch-1', {});

      expect(result.rows).toEqual([
        {
          member_name: 'Bob',
          date: '2026-02-20',
          duration_minutes: 120,
          description: 'Community service',
          status: 'APPROVED',
        },
      ]);
    });

    it('looks up each member once, however many entries they have', async () => {
      repo.findServiceEntries.mockResolvedValue(
        complete([entry('u-1', 'a'), entry('u-2', 'b'), entry('u-1', 'c')]),
      );

      await service.getServiceReport('ch-1', {});

      expect(users.findDisplayIdentitiesByIds).toHaveBeenCalledWith([
        'u-1',
        'u-2',
      ]);
    });

    it('forwards the filters and returns empty without a user lookup', async () => {
      const result = await service.getServiceReport('ch-1', {
        user_id: 'u-1',
        start_date: '2025-01-01',
        end_date: '2025-12-31',
      });

      expect(repo.findServiceEntries).toHaveBeenCalledWith(
        'ch-1',
        { userId: 'u-1', startDate: '2025-01-01', endDate: '2025-12-31' },
        REPORT_MAX_ROWS,
      );
      expect(result.rows).toEqual([]);
      expect(users.findDisplayIdentitiesByIds).not.toHaveBeenCalled();
    });

    it('carries the read’s truncation out with the row ceiling', async () => {
      repo.findServiceEntries.mockResolvedValue({
        rows: [entry('u-1', 'a')],
        truncated: true,
      });

      const result = await service.getServiceReport('ch-1', {});

      expect(result).toMatchObject({
        truncated: true,
        limit: REPORT_MAX_ROWS,
      });
    });
  });
});
