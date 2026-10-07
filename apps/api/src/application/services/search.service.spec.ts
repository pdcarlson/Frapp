import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { RbacService } from './rbac.service';
import { ChatBlockService } from './chat-block.service';
import { BLOCKED_MESSAGE_CONTENT } from './chat-block-mask';
import {
  SEARCH_REPOSITORY,
  type ISearchRepository,
} from '#domain/repositories/search.repository.interface';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';
import { Logger } from '@nestjs/common';

/**
 * `SearchService` decides what the caller may see; the queries are
 * `SupabaseSearchRepository`'s, and their shape (the text-search parse mode,
 * the explicit column lists, the uuid push-down, the one-query member join) is
 * pinned in `supabase-search.repository.spec.ts`.
 */
describe('SearchService', () => {
  let service: SearchService;
  let repo: { [K in keyof ISearchRepository]: jest.Mock };
  let mockRbacService: {
    getEffectivePermissions: jest.Mock;
    memberHasAnyPermission: jest.Mock;
  };
  let mockChatBlocks: { listBlockedUserIds: jest.Mock };

  const channel = (
    id: string,
    type: string,
    access: {
      member_ids?: string[] | null;
      required_permissions?: string[] | null;
    } = {},
  ) => ({
    id,
    type,
    member_ids: access.member_ids ?? null,
    required_permissions: access.required_permissions ?? null,
  });

  const noRepoCalls = () => {
    for (const fn of Object.values(repo)) {
      expect(fn).not.toHaveBeenCalled();
    }
  };

  beforeEach(async () => {
    repo = {
      searchBackwork: jest.fn().mockResolvedValue([]),
      searchEvents: jest.fn().mockResolvedValue([]),
      searchMembers: jest.fn().mockResolvedValue([]),
      searchMessages: jest.fn().mockResolvedValue([]),
      findChannelsForAccess: jest.fn().mockResolvedValue([]),
      findMemberId: jest.fn().mockResolvedValue('member-1'),
      findMemberRoleIds: jest.fn().mockResolvedValue([]),
    };

    mockRbacService = {
      getEffectivePermissions: jest.fn().mockResolvedValue([]),
      memberHasAnyPermission: jest.fn().mockResolvedValue(false),
    };

    mockChatBlocks = { listBlockedUserIds: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: SEARCH_REPOSITORY, useValue: repo },
        { provide: RbacService, useValue: mockRbacService },
        { provide: ChatBlockService, useValue: mockChatBlocks },
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
      noRepoCalls();
    });

    it('should return grouped results from all domains', async () => {
      repo.searchEvents.mockResolvedValue([
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
      ]);
      repo.searchMembers.mockResolvedValue([
        {
          id: 'm-1',
          user_id: 'user-1',
          chapter_id: 'ch-1',
          display_name: 'Ann Meeting',
          email: 'ann@test.dev',
        },
      ]);
      repo.findChannelsForAccess.mockResolvedValue([channel('pub', 'PUBLIC')]);

      const result = await service.search('ch-1', 'user-1', 'meeting');

      expect(result.backwork).toHaveLength(0);
      expect(result.events).toHaveLength(1);
      expect(result.events[0].name).toBe('Chapter Meeting');
      expect(result.members).toHaveLength(1);
      expect(result.members[0].display_name).toBe('Ann Meeting');
      expect(result.messages).toHaveLength(0);
    });

    it('hands every source the trimmed query, the chapter and the per-source cap', async () => {
      repo.findChannelsForAccess.mockResolvedValue([channel('pub', 'PUBLIC')]);

      await service.search('ch-1', 'user-1', '  meeting  ');

      expect(repo.searchBackwork).toHaveBeenCalledWith('ch-1', 'meeting', 10);
      expect(repo.searchEvents).toHaveBeenCalledWith('ch-1', 'meeting', 10);
      expect(repo.searchMembers).toHaveBeenCalledWith('ch-1', 'meeting', 10);
      expect(repo.searchMessages).toHaveBeenCalledWith(['pub'], 'meeting', 10);
    });

    it('lets a failed source propagate as the repository threw it', async () => {
      // A `SupabaseQueryError` is not an HttpException, so `AllExceptionsFilter`
      // answers it with the generic 500 body and sends the code to Sentry
      // (#1264); the service must not rewrap it into one carrying PostgREST's
      // text.
      const failure = new SupabaseQueryError({
        code: '42P01',
        message: 'relation "backwork_resources" does not exist',
      });
      repo.searchBackwork.mockRejectedValue(failure);

      await expect(service.search('ch-1', 'user-1', 'meeting')).rejects.toBe(
        failure,
      );
    });

    it('should scope message search to channels the caller can access', async () => {
      repo.findChannelsForAccess.mockResolvedValue([
        channel('pub', 'PUBLIC'),
        channel('priv-in', 'PRIVATE', { member_ids: ['user-1'] }),
        channel('priv-out', 'PRIVATE', { member_ids: ['user-2'] }),
        channel('gated-yes', 'ROLE_GATED', {
          required_permissions: ['alumni:view'],
        }),
        channel('gated-no', 'ROLE_GATED', {
          required_permissions: ['secret:view'],
        }),
      ]);

      // The permission set resolves through RbacService, so custom-role
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
      expect(repo.findChannelsForAccess).toHaveBeenCalledWith(
        'ch-1',
        undefined,
      );
      expect(repo.findMemberId).toHaveBeenCalledWith('ch-1', 'user-1');
      const [searchedChannelIds] = repo.searchMessages.mock.calls[0] as [
        string[],
      ];
      expect(searchedChannelIds).toEqual(['pub', 'priv-in', 'gated-yes']);
    });

    describe('single-channel scope (#469)', () => {
      const PUB = '11111111-1111-4111-8111-111111111111';
      const PUB2 = '22222222-2222-4222-8222-222222222222';
      const PRIV_OUT = '33333333-3333-4333-8333-333333333333';
      const UNKNOWN_ID = '44444444-4444-4444-8444-444444444444';
      // `spec/behavior/chat/README.md`: "full-text search within a single
      // channel or across all channels the user can access."
      //
      // These drive `searchWithinBudget`, NOT `search()`. `search()` has no
      // caller outside this file — the HTTP route calls `searchWithinBudget` —
      // so testing through it would have left the route's own `channelId`
      // forwarding unexercised, and a refactor that dropped the argument there
      // would have degraded every channel-scoped search to chapter-wide with a
      // fully green suite.
      //
      // The double returns every channel whatever id it is handed, as a
      // repository that dropped its push-down would. That is deliberate: the
      // service's own intersection is the correctness guarantee, and these
      // cases pin it independently of the push-down.
      beforeEach(() => {
        repo.findChannelsForAccess.mockResolvedValue([
          channel(PUB, 'PUBLIC'),
          channel(PUB2, 'PUBLIC'),
          channel(PRIV_OUT, 'PRIVATE', { member_ids: ['user-2'] }),
        ]);
        repo.searchMessages.mockResolvedValue([{ id: 'm-1', channel_id: PUB }]);
      });

      it('narrows the message scan to the one requested channel', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', 'hello', PUB2);

        // The whole point: the narrowing reaches SQL. Filtering client-side
        // would be wrong, because SEARCH_LIMIT is applied by the database
        // across every accessible channel before any client sees a row.
        expect(repo.searchMessages).toHaveBeenCalledWith([PUB2], 'hello', 10);
      });

      it('passes the channel id down as the candidate narrowing', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', 'hello', PUB2);

        expect(repo.findChannelsForAccess).toHaveBeenCalledWith('ch-1', PUB2);
      });

      it('returns nothing for a channel the caller cannot read, without a 403', async () => {
        const { results: result } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hello',
          PRIV_OUT,
        );

        // Never queried: the id intersects the accessible set to nothing, so
        // the scan is skipped entirely rather than run against every channel.
        expect(repo.searchMessages).not.toHaveBeenCalled();
        expect(result.messages).toEqual([]);
      });

      it('returns nothing for a channel id that does not exist', async () => {
        const { results: result } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hello',
          UNKNOWN_ID,
        );

        // Same empty answer as an inaccessible channel, deliberately: telling
        // the two apart would make search a channel-existence oracle.
        expect(repo.searchMessages).not.toHaveBeenCalled();
        expect(result.messages).toEqual([]);
      });

      it('returns nothing for a malformed channel id', async () => {
        // The repository skips the push-down for a non-uuid; the intersection
        // then matches nothing, which is the "no matches" the contract
        // promises rather than an error.
        const { results } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hello',
          'general',
        );

        expect(repo.searchMessages).not.toHaveBeenCalled();
        expect(results.messages).toEqual([]);
      });

      it('runs only the message source, leaving the other three empty', async () => {
        const { results: result } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hello',
          PUB,
        );

        expect(result.messages).toHaveLength(1);
        expect(result.backwork).toEqual([]);
        expect(result.events).toEqual([]);
        expect(result.members).toEqual([]);
        // A channel-scoped query is definitionally a chat search; firing the
        // other three would be work no such caller renders, once per
        // debounced keystroke on an @ThrottleExpensiveRead() route.
        expect(repo.searchBackwork).not.toHaveBeenCalled();
        expect(repo.searchEvents).not.toHaveBeenCalled();
        expect(repo.searchMembers).not.toHaveBeenCalled();
      });

      it('still fans out to all four sources when no channel is named', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', 'hello');

        expect(repo.searchBackwork).toHaveBeenCalled();
        expect(repo.searchEvents).toHaveBeenCalled();
        expect(repo.findChannelsForAccess).toHaveBeenCalledWith(
          'ch-1',
          undefined,
        );
        expect(repo.searchMessages).toHaveBeenCalledWith(
          [PUB, PUB2],
          'hello',
          10,
        );
      });

      it('still refuses a sub-minimum query, channel or not', async () => {
        const { results: result } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hi',
          PUB,
        );

        noRepoCalls();
        expect(result.messages).toEqual([]);
      });
    });

    describe('blocked senders (#2257)', () => {
      /*
        Search is a message read surface, so it owes the same mask the timeline
        does — and it is the one place a member goes looking for text, so an
        unmasked search is a full-text index over the messages they blocked.
        `spec/behavior/chat/README.md` § The masking contract.
      */
      const wireMessages = (rows: unknown[]) => {
        repo.findChannelsForAccess.mockResolvedValue([
          channel('pub', 'PUBLIC'),
        ]);
        // `accessibleChannelIds` returns empty without a membership, so the
        // message source would never run and the mask would never be reached —
        // the tests below would pass for the wrong reason.
        repo.findMemberId.mockResolvedValue('mem-1');
        repo.searchMessages.mockResolvedValue(rows);
      };

      const hit = (overrides: Record<string, unknown> = {}) => ({
        id: 'msg-1',
        channel_id: 'pub',
        sender_id: 'user-2',
        content: 'go away',
        type: 'TEXT',
        reply_to_id: null,
        metadata: {},
        is_pinned: false,
        pinned_at: null,
        edited_at: null,
        is_deleted: false,
        created_at: '2026-03-01T00:00:00.000Z',
        ...overrides,
      });

      it('masks a hit from a member the caller has blocked', async () => {
        wireMessages([hit()]);
        mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-2']);

        const result = await service.search('ch-1', 'user-1', 'away');

        expect(mockChatBlocks.listBlockedUserIds).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
        );
        expect(result.messages).toHaveLength(1);
        expect(result.messages[0].content).toBe(BLOCKED_MESSAGE_CONTENT);
        expect(result.messages[0].sender_blocked).toBe(true);
      });

      it('reads the block list once per search, not once per hit', async () => {
        // A per-hit read would still mask correctly, so only the call count
        // catches it (#2310).
        wireMessages([
          hit(),
          hit({ id: 'msg-2', sender_id: 'user-3', content: 'come away' }),
        ]);
        mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-2']);

        const result = await service.search('ch-1', 'user-1', 'away');

        expect(result.messages.map((m) => m.sender_blocked)).toEqual([
          true,
          false,
        ]);
        expect(mockChatBlocks.listBlockedUserIds).toHaveBeenCalledTimes(1);
      });

      it('flags an unblocked hit rather than leaving the field absent', async () => {
        wireMessages([hit({ sender_id: 'user-3', content: 'come along' })]);
        mockChatBlocks.listBlockedUserIds.mockResolvedValue(['user-2']);

        const result = await service.search('ch-1', 'user-1', 'along');

        expect(result.messages[0].sender_blocked).toBe(false);
        expect(result.messages[0].content).toBe('come along');
      });

      it('fails the source when the block list cannot be read', async () => {
        // "A block list that cannot be read is not an empty block list."
        // `withinBudget` degrades a slow source to an empty array, so the worst
        // case for a caller is no message results — never unmasked ones.
        wireMessages([hit()]);
        mockChatBlocks.listBlockedUserIds.mockRejectedValue(
          new Error('pg down'),
        );

        await expect(service.search('ch-1', 'user-1', 'away')).rejects.toThrow(
          'pg down',
        );
      });

      it('does not read the block list when no channel is searchable', async () => {
        // The read is deliberately after the match rather than concurrent with
        // it: `searchMessages` returns early in several places, and a
        // `Promise.all` would pay for the block read on every one of them.
        repo.findChannelsForAccess.mockResolvedValue([]);

        await service.search('ch-1', 'user-1', 'away');

        expect(mockChatBlocks.listBlockedUserIds).not.toHaveBeenCalled();
      });
    });

    it('should not query messages at all for a non-member', async () => {
      repo.findChannelsForAccess.mockResolvedValue([channel('pub', 'PUBLIC')]);
      // caller is not in this chapter
      repo.findMemberId.mockResolvedValue(null);

      const result = await service.search('ch-1', 'outsider', 'hello');

      expect(result.messages).toEqual([]);
      expect(repo.searchMessages).not.toHaveBeenCalled();
      expect(mockRbacService.getEffectivePermissions).not.toHaveBeenCalled();
    });

    // Search must not become a side-channel around EventService's read
    // visibility (#1463): a role-targeted event a viewer can't see via
    // `GET /v1/events` must not surface here either.
    describe('role-targeted event visibility (#1463)', () => {
      const targetedEvent = {
        id: 'ev-targeted',
        chapter_id: 'ch-1',
        name: 'Exec Meeting',
        description: null,
        start_time: '2026-02-26T10:00:00Z',
        end_time: '2026-02-26T11:00:00Z',
        point_value: 10,
        is_mandatory: false,
        required_role_ids: ['role-officer'],
      };

      it('drops a role-targeted event for a viewer without a matching role', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        repo.findMemberRoleIds.mockResolvedValue(['role-member']);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(repo.findMemberRoleIds).toHaveBeenCalledWith('ch-1', 'user-1');
        expect(result.events).toEqual([]);
      });

      it('drops a role-targeted event for a caller with no membership', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        repo.findMemberRoleIds.mockResolvedValue([]);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toEqual([]);
      });

      it('keeps a role-targeted event for a viewer with a matching role', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        repo.findMemberRoleIds.mockResolvedValue(['role-officer']);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(result.events[0].id).toBe('ev-targeted');
      });

      it('keeps a role-targeted event for a viewer holding events:update, regardless of role', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        repo.findMemberRoleIds.mockResolvedValue(['role-member']);
        mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(mockRbacService.memberHasAnyPermission).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          expect.arrayContaining(['events:update']),
        );
        // The events:update check short-circuits before the role lookup.
        expect(repo.findMemberRoleIds).not.toHaveBeenCalled();
      });

      it('does not look up roles at all when no matched event is role-targeted', async () => {
        const untargeted = { ...targetedEvent, required_role_ids: null };
        repo.searchEvents.mockResolvedValue([untargeted]);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(mockRbacService.memberHasAnyPermission).not.toHaveBeenCalled();
        expect(repo.findMemberRoleIds).not.toHaveBeenCalled();
      });
    });
  });

  describe('searchWithinBudget', () => {
    const emptyResult = {
      backwork: [],
      events: [],
      members: [],
      messages: [],
    };

    /** A read that never settles, for driving the budget. */
    const hanging = () => new Promise<never>(() => {});

    /** A read that fails only after `ms`. */
    const failingAfter = (ms: number) =>
      new Promise<never>((_resolve, reject) =>
        setTimeout(
          () =>
            reject(
              new SupabaseQueryError({
                code: '57014',
                message: 'canceling statement',
              }),
            ),
          ms,
        ),
      );

    const TIMEOUT_LINE = 'reported to the caller as a timeout';
    const loggedText = (spy: jest.SpyInstance) =>
      spy.mock.calls.flat().map(String).join('\n');

    /** One event hit and one readable channel, so every source has work. */
    const wireSources = () => {
      repo.searchEvents.mockResolvedValue([
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
      ]);
      repo.findChannelsForAccess.mockResolvedValue([channel('pub', 'PUBLIC')]);
    };

    it('returns an untouched result when every source is inside the budget', async () => {
      wireSources();

      const outcome = await service.searchWithinBudget(
        'ch-1',
        'user-1',
        'meeting',
      );

      expect(outcome.timedOut).toBe(false);
      expect(outcome.timedOutSources).toEqual([]);
      expect(outcome.results.events).toHaveLength(1);
    });

    it('short-circuits a query below the minimum length without a budget', async () => {
      const outcome = await service.searchWithinBudget('ch-1', 'user-1', 'ab');

      expect(outcome).toEqual({
        results: emptyResult,
        timedOut: false,
        timedOutSources: [],
      });
    });

    it('propagates a failure inside the budget without logging it as a timeout', async () => {
      // The late-failure logger used to read a flag the race's continuation had
      // not set yet, so every fast failure also logged a false "timeout" line
      // beside the 500 it actually became.
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        wireSources();
        repo.searchBackwork.mockRejectedValue(
          new SupabaseQueryError({
            code: '42P01',
            message: 'relation does not exist',
          }),
        );

        await expect(
          service.searchWithinBudget('ch-1', 'user-1', 'meeting'),
        ).rejects.toBeInstanceOf(SupabaseQueryError);
        await new Promise((resolve) => setImmediate(resolve));

        expect(loggedText(logged)).not.toContain(TIMEOUT_LINE);
      } finally {
        logged.mockRestore();
      }
    });

    it('logs a failure that lands after the budget, which the caller only saw as a timeout', async () => {
      jest.useFakeTimers();
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        wireSources();
        repo.searchBackwork.mockImplementation(() => failingAfter(1_000));

        const promise = service.searchWithinBudget('ch-1', 'user-1', 'meeting');
        await jest.advanceTimersByTimeAsync(500);
        const outcome = await promise;
        expect(outcome.timedOutSources).toEqual(['backwork']);
        expect(loggedText(logged)).not.toContain(TIMEOUT_LINE);

        await jest.advanceTimersByTimeAsync(1_000);
        expect(loggedText(logged)).toContain(
          `search source "backwork" failed after the 500ms budget; ${TIMEOUT_LINE}`,
        );
      } finally {
        logged.mockRestore();
        jest.useRealTimers();
      }
    });

    it('degrades ONLY the slow source, and names it', async () => {
      // This is the regression the per-source budget exists for. The budget used
      // to wrap the whole `Promise.all`, so one slow query returned four empty
      // arrays — the events hit below was already in hand and got thrown away,
      // and the UI rendered it identically to a genuine miss.
      jest.useFakeTimers();
      try {
        wireSources();
        repo.searchMessages.mockImplementation(hanging);

        const promise = service.searchWithinBudget('ch-1', 'user-1', 'meeting');
        await jest.advanceTimersByTimeAsync(500);
        const outcome = await promise;

        expect(outcome.timedOut).toBe(true);
        expect(outcome.timedOutSources).toEqual(['messages']);
        expect(outcome.results.messages).toEqual([]);
        // The half that used to be lost.
        expect(outcome.results.events).toHaveLength(1);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
