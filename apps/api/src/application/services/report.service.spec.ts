import { Test, TestingModule } from '@nestjs/testing';
import { ReportService } from './report.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('ReportService', () => {
  let service: ReportService;
  let mockSupabase: jest.Mocked<Pick<SupabaseClient, 'from'>>;

  const makeChain = (resolveValue: { data: unknown[]; error: unknown }) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: jest.fn().mockReturnValue(chain),
      eq: jest.fn().mockReturnValue(chain),
      in: jest.fn().mockReturnValue(chain),
      gte: jest.fn().mockReturnValue(chain),
      lte: jest.fn().mockReturnValue(chain),
      order: jest.fn().mockReturnValue(chain),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(resolveValue).then(resolve),
      catch: (fn: (e: unknown) => void) => Promise.reject().catch(fn),
    });
    return chain;
  };

  beforeEach(async () => {
    mockSupabase = {
      from: jest
        .fn()
        .mockImplementation(() => makeChain({ data: [], error: null })),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportService,
        {
          provide: SUPABASE_CLIENT,
          useValue: mockSupabase,
        },
      ],
    }).compile();

    service = module.get(ReportService);
  });

  describe('getAttendanceReport', () => {
    it('should return attendance report data for event filter', async () => {
      const eventsChain = makeChain({ data: [{ id: 'ev-1' }], error: null });
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

      (mockSupabase.from as jest.Mock).mockImplementation((t: string) =>
        t === 'events' ? eventsChain : attChain,
      );

      const result = await service.getAttendanceReport('ch-1', {
        event_id: 'ev-1',
      });

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
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

      expect(result).toEqual([]);
    });
  });

  describe('getPointsReport', () => {
    it('should return points report with breakdown by category', async () => {
      const txnChain = makeChain({
        data: [
          { user_id: 'u-1', amount: 10, category: 'ATTENDANCE' },
          { user_id: 'u-1', amount: 5, category: 'SERVICE' },
        ],
        error: null,
      });
      const usersChain = makeChain({
        data: [{ id: 'u-1', display_name: 'Jane' }],
        error: null,
      });

      (mockSupabase.from as jest.Mock).mockImplementation((t: string) =>
        t === 'point_transactions' ? txnChain : usersChain,
      );

      const result = await service.getPointsReport('ch-1', {});

      expect(result).toHaveLength(1);
      expect(result[0].member_name).toBe('Jane');
      expect(result[0].total_points).toBe(15);
      expect(result[0].breakdown_by_category).toEqual({
        ATTENDANCE: 10,
        SERVICE: 5,
      });
    });

    it('should return empty array when no transactions', async () => {
      (mockSupabase.from as jest.Mock).mockReturnValue(
        makeChain({ data: [], error: null }),
      );

      const result = await service.getPointsReport('ch-1', {});

      expect(result).toEqual([]);
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

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
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

      expect(result).toEqual([]);
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

      expect(result).toHaveLength(1);
      expect(result[0]).toEqual({
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

      expect(result).toEqual([]);
    });
  });
});
