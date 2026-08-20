import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import { RbacService } from './rbac.service';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

describe('SearchService', () => {
  let service: SearchService;
  let mockSupabase: jest.Mocked<Pick<FrappSupabaseClient, 'from'>>;
  let mockRbacService: { getEffectivePermissions: jest.Mock };

  const makeChain = (resolveValue: { data: unknown[]; error: unknown }) => {
    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: jest.fn().mockReturnValue(chain),
      eq: jest.fn().mockReturnValue(chain),
      in: jest.fn().mockReturnValue(chain),
      ilike: jest.fn().mockReturnValue(chain),
      or: jest.fn().mockReturnValue(chain),
      limit: jest.fn().mockReturnValue(chain),
      order: jest.fn().mockReturnValue(chain),
      then: (resolve: (v: unknown) => void) =>
        Promise.resolve(resolveValue).then(resolve),
      catch: () => Promise.reject().catch(() => {}),
    });
    return chain;
  };

  beforeEach(async () => {
    mockSupabase = {
      from: jest
        .fn()
        .mockImplementation(() => makeChain({ data: [], error: null })),
    };

    mockRbacService = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: SUPABASE_CLIENT,
          useValue: mockSupabase,
        },
        { provide: RbacService, useValue: mockRbacService },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  describe('search', () => {
    it('should return empty results for empty query', async () => {
      const result = await service.search('ch-1', 'user-1', '');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
    });

    it('should return empty results for whitespace-only query', async () => {
      const result = await service.search('ch-1', 'user-1', '   ');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
    });

    it('should return empty results without querying for sub-3-char queries', async () => {
      const result = await service.search('ch-1', 'user-1', 'ab');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
      // Spec default: shorter queries never touch the database.
      expect(mockSupabase.from).not.toHaveBeenCalled();
    });

    it('should return grouped results from all domains', async () => {
      const backworkChain = makeChain({ data: [], error: null });
      const eventsChain = makeChain({
        data: [
          {
            id: 'ev-1',
            chapter_id: 'ch-1',
            name: 'Chapter Meeting',
            description: 'Weekly meeting',
            start_time: '2026-02-26T10:00:00Z',
            end_time: '2026-02-26T11:00:00Z',
            point_value: 10,
            is_mandatory: false,
          },
        ],
        error: null,
      });
      const membersChain = makeChain({
        data: [
          {
            id: 'm-1',
            user_id: 'user-1',
            chapter_id: 'ch-1',
            role_ids: ['role-1'],
          },
        ],
        error: null,
      });
      const usersChain = makeChain({ data: [], error: null });
      const rolesChain = makeChain({
        data: [{ permissions: [] }],
        error: null,
      });
      const channelsChain = makeChain({
        data: [
          {
            id: 'pub',
            type: 'PUBLIC',
            member_ids: null,
            required_permissions: null,
          },
        ],
        error: null,
      });
      const messagesChain = makeChain({ data: [], error: null });

      (mockSupabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'backwork_resources') return backworkChain;
        if (t === 'events') return eventsChain;
        if (t === 'members') return membersChain;
        if (t === 'users') return usersChain;
        if (t === 'roles') return rolesChain;
        if (t === 'chat_channels') return channelsChain;
        if (t === 'chat_messages') return messagesChain;
        return makeChain({ data: [], error: null });
      });

      const result = await service.search('ch-1', 'user-1', 'meeting');

      expect(result.backwork).toHaveLength(0);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].name).toBe('Chapter Meeting');
      expect(result.members).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it('should scope message search to channels the caller can access', async () => {
      let searchedChannelIds: string[] = [];

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        if (table === 'chat_channels') {
          return makeChain({
            data: [
              {
                id: 'pub',
                type: 'PUBLIC',
                member_ids: null,
                required_permissions: null,
              },
              {
                id: 'priv-in',
                type: 'PRIVATE',
                member_ids: ['user-1'],
                required_permissions: null,
              },
              {
                id: 'priv-out',
                type: 'PRIVATE',
                member_ids: ['user-2'],
                required_permissions: null,
              },
              {
                id: 'gated-yes',
                type: 'ROLE_GATED',
                member_ids: null,
                required_permissions: ['alumni:view'],
              },
              {
                id: 'gated-no',
                type: 'ROLE_GATED',
                member_ids: null,
                required_permissions: ['secret:view'],
              },
            ],
            error: null,
          });
        }
        if (table === 'members') {
          return makeChain({ data: [{ id: 'member-1' }], error: null });
        }
        if (table === 'chat_messages') {
          const chain: Record<string, unknown> = {};
          Object.assign(chain, {
            select: jest.fn().mockReturnValue(chain),
            in: jest.fn().mockImplementation((_col: string, ids: string[]) => {
              searchedChannelIds = ids;
              return chain;
            }),
            ilike: jest.fn().mockReturnValue(chain),
            eq: jest.fn().mockReturnValue(chain),
            limit: jest.fn().mockReturnValue(chain),
            order: jest.fn().mockReturnValue(chain),
            then: (resolve: (v: unknown) => void) =>
              Promise.resolve({ data: [], error: null }).then(resolve),
            catch: () => Promise.reject().catch(() => {}),
          });
          return chain;
        }
        return makeChain({ data: [], error: null });
      });

      // The permission set now resolves through RbacService, so custom-role
      // capabilities gate search exactly as they gate chat channel access
      // (bridge model, spec/behavior/rbac.md).
      mockRbacService.getEffectivePermissions.mockResolvedValue([
        'alumni:view',
      ]);

      await service.search('ch-1', 'user-1', 'hello');

      expect(mockRbacService.getEffectivePermissions).toHaveBeenCalledWith(
        'ch-1',
        'user-1',
      );
      expect(searchedChannelIds).toEqual(['pub', 'priv-in', 'gated-yes']);
      expect(searchedChannelIds).not.toContain('priv-out');
      expect(searchedChannelIds).not.toContain('gated-no');
    });

    it('should not query messages at all for a non-member', async () => {
      const fromCalls: string[] = [];
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls.push(table);
        if (table === 'chat_channels') {
          return makeChain({
            data: [
              {
                id: 'pub',
                type: 'PUBLIC',
                member_ids: null,
                required_permissions: null,
              },
            ],
            error: null,
          });
        }
        // members → empty: caller is not in this chapter
        return makeChain({ data: [], error: null });
      });

      const result = await service.search('ch-1', 'outsider', 'hello');

      expect(result.messages).toEqual([]);
      expect(fromCalls).not.toContain('chat_messages');
    });

    it('should escape filter values in .or queries', async () => {
      let backworkOrCall = '';
      let eventsOrCall = '';

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        const chain: Record<string, unknown> = {};
        Object.assign(chain, {
          select: jest.fn().mockReturnValue(chain),
          eq: jest.fn().mockReturnValue(chain),
          in: jest.fn().mockReturnValue(chain),
          ilike: jest.fn().mockReturnValue(chain),
          or: jest.fn().mockImplementation((query) => {
            if (table === 'backwork_resources') backworkOrCall = query;
            if (table === 'events') eventsOrCall = query;
            return chain;
          }),
          limit: jest.fn().mockReturnValue(chain),
          order: jest.fn().mockReturnValue(chain),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
          catch: () => Promise.reject().catch(() => {}),
        });
        return chain;
      });

      await service.search('ch-1', 'user-1', 'test\\query"()');

      // Given the pattern is `%test\query"()%`
      // The expected escaped pattern would be `"%test\\query\"()%"`
      const expectedSafePattern = '"%test\\\\query\\"()%"';

      expect(backworkOrCall).toBe(
        `title.ilike.${expectedSafePattern},course_number.ilike.${expectedSafePattern}`,
      );
      expect(eventsOrCall).toBe(
        `name.ilike.${expectedSafePattern},description.ilike.${expectedSafePattern}`,
      );
    });

    it('should escape commas in filter values to prevent PostgREST injection', async () => {
      let backworkOrCall = '';

      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        const chain: Record<string, unknown> = {};
        Object.assign(chain, {
          select: jest.fn().mockReturnValue(chain),
          eq: jest.fn().mockReturnValue(chain),
          in: jest.fn().mockReturnValue(chain),
          ilike: jest.fn().mockReturnValue(chain),
          or: jest.fn().mockImplementation((query) => {
            if (table === 'backwork_resources') backworkOrCall = query;
            return chain;
          }),
          limit: jest.fn().mockReturnValue(chain),
          order: jest.fn().mockReturnValue(chain),
          then: (resolve: (v: unknown) => void) =>
            Promise.resolve({ data: [], error: null }).then(resolve),
          catch: () => Promise.reject().catch(() => {}),
        });
        return chain;
      });

      await service.search('ch-1', 'user-1', 'test,id.eq.secret');

      expect(backworkOrCall).toContain('"%test,id.eq.secret%"');
    });
  });

  describe('searchWithinBudget', () => {
    const emptyResult = {
      backwork: [],
      events: [],
      members: [],
      messages: [],
    };

    it('passes through results when search resolves within the budget', async () => {
      const results = { ...emptyResult, events: [{ id: 'ev-1' }] } as never;
      jest.spyOn(service, 'search').mockResolvedValue(results);

      const outcome = await service.searchWithinBudget(
        'ch-1',
        'user-1',
        'hello',
      );

      expect(outcome).toEqual({ results, timedOut: false });
    });

    it('returns empty results and timedOut when search exceeds the budget', async () => {
      jest.useFakeTimers();
      try {
        // A search that never settles within the budget window.
        jest
          .spyOn(service, 'search')
          .mockReturnValue(new Promise(() => {}) as never);

        const promise = service.searchWithinBudget('ch-1', 'user-1', 'hello');
        await jest.advanceTimersByTimeAsync(500);
        const outcome = await promise;

        expect(outcome).toEqual({ results: emptyResult, timedOut: true });
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
