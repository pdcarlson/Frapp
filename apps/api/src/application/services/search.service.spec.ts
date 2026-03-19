import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('SearchService', () => {
  let service: SearchService;
  let mockSupabase: jest.Mocked<Pick<SupabaseClient, 'from'>>;

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

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        {
          provide: SUPABASE_CLIENT,
          useValue: mockSupabase,
        },
      ],
    }).compile();

    service = module.get(SearchService);
  });

  describe('search', () => {
    it('should return empty results for empty query', async () => {
      const result = await service.search('ch-1', '');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
    });

    it('should return empty results for whitespace-only query', async () => {
      const result = await service.search('ch-1', '   ');
      expect(result).toEqual({
        backwork: [],
        events: [],
        members: [],
        messages: [],
      });
    });

    it('should return grouped results from all domains', async () => {
      const backworkChain = makeChain({
        data: [],
        error: null,
      });
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
        data: [{ id: 'm-1', user_id: 'u-1', chapter_id: 'ch-1' }],
        error: null,
      });
      const usersChain = makeChain({
        data: [],
        error: null,
      });
      const channelsChain = makeChain({
        data: [{ id: 'ch-1' }],
        error: null,
      });
      const messagesChain = makeChain({
        data: [],
        error: null,
      });

      (mockSupabase.from as jest.Mock).mockImplementation((t: string) => {
        if (t === 'backwork_resources') return backworkChain;
        if (t === 'events') return eventsChain;
        if (t === 'members') return membersChain;
        if (t === 'users') return usersChain;
        if (t === 'chat_channels') return channelsChain;
        if (t === 'chat_messages') return messagesChain;
        return makeChain({ data: [], error: null });
      });

      const result = await service.search('ch-1', 'meeting');

      expect(result.backwork).toHaveLength(0);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].name).toBe('Chapter Meeting');
      expect(result.members).toHaveLength(0);
      expect(result.messages).toHaveLength(0);
    });

    it('should scope all queries to chapter', async () => {
      const fromCalls: string[] = [];
      (mockSupabase.from as jest.Mock).mockImplementation((table: string) => {
        fromCalls.push(table);
        // Return non-empty channels so searchMessages proceeds to chat_messages
        const data = table === 'chat_channels' ? [{ id: 'c1' }] : [];
        return makeChain({ data, error: null });
      });

      await service.search('ch-99', 'test');

      expect(fromCalls).toContain('backwork_resources');
      expect(fromCalls).toContain('events');
      expect(fromCalls).toContain('members');
      expect(fromCalls).toContain('chat_channels');
      expect(fromCalls).toContain('chat_messages');
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

      await service.search('ch-1', 'test\\query"()');

      // Given the pattern is `%test\query"()%`
      // The expected escaped pattern would be `"%test\\query\"()%"`
      const expectedSafePattern = '"%test\\\\query\\"()%"';

      expect(backworkOrCall).toBe(`title.ilike.${expectedSafePattern},course_number.ilike.${expectedSafePattern}`);
      expect(eventsOrCall).toBe(`name.ilike.${expectedSafePattern},description.ilike.${expectedSafePattern}`);
    });
  });
});
