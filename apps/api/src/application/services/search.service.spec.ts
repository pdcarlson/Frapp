import * as Sentry from '@sentry/nestjs';
import { Test, TestingModule } from '@nestjs/testing';
import { SearchService } from './search.service';
import { RbacService } from './rbac.service';
import { ChatBlockService } from './chat-block.service';
import { BLOCKED_MESSAGE_CONTENT } from './chat-block-mask';
import {
  SEARCH_REPOSITORY,
  type ISearchRepository,
} from '#domain/repositories/search.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import { EMPTY_ACCESS_HOLDER } from '#domain/utils/channel-access';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';
import { Logger } from '@nestjs/common';
import { SupabaseSearchRepository } from '../../infrastructure/supabase/repositories/supabase-search.repository';
import {
  CHAPTER_A,
  createTenantHarness,
  inA,
  inB,
} from '#test/helpers/tenant-scope.harness';

jest.mock('@sentry/nestjs', () => ({
  captureException: jest.fn(() => 'event-exception'),
  captureMessage: jest.fn(() => 'event-message'),
}));

const captureException = jest.mocked(Sentry.captureException);

/**
 * `SearchService` decides what the caller may see; the queries are
 * `SupabaseSearchRepository`'s, and their shape (the text-search parse mode,
 * the explicit column lists, the uuid push-down, the one-query member join) is
 * pinned in `supabase-search.repository.spec.ts`.
 */
describe('SearchService', () => {
  let service: SearchService;
  let repo: { [K in keyof ISearchRepository]: jest.Mock };
  let members: { findByUserAndChapter: jest.Mock };
  /** The caller's membership, as the member repository returns it. */
  const membership = (roleIds: string[] = []) => ({
    id: 'member-1',
    role_ids: roleIds,
  });
  let mockRbacService: {
    getChannelAccessHolder: jest.Mock;
    memberHasAnyPermission: jest.Mock;
  };
  let mockChatBlocks: { listBlockedUserIds: jest.Mock };

  const channel = (
    id: string,
    type: string,
    access: {
      member_ids?: string[] | null;
      who_can_see?: string[] | null;
    } = {},
  ) => ({
    id,
    type,
    member_ids: access.member_ids ?? null,
    who_can_see: access.who_can_see ?? null,
  });

  // Tiers a who-can-see list names (#3722): the caller's, and one they lack.
  const CALLER_ROLE = '00000000-0000-4000-8000-0000000001e1';
  const CALLER_TIER = `tier:00000000-0000-4000-8000-0000000071e1`;
  const SECRET_TIER = `tier:00000000-0000-4000-8000-00000000c0de`;

  const noRepoCalls = () => {
    for (const fn of [...Object.values(repo), members.findByUserAndChapter]) {
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
    };
    members = {
      findByUserAndChapter: jest.fn().mockResolvedValue(membership()),
    };

    mockRbacService = {
      getChannelAccessHolder: jest.fn().mockResolvedValue(EMPTY_ACCESS_HOLDER),
      // A caller who may browse backwork and does not manage events: the
      // ordinary active member the fan-out tests assume.
      memberHasAnyPermission: jest.fn(
        async (_chapterId: string, _userId: string, permissions: string[]) =>
          permissions.includes('backwork:upload'),
      ),
    };

    mockChatBlocks = { listBlockedUserIds: jest.fn().mockResolvedValue([]) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: SEARCH_REPOSITORY, useValue: repo },
        { provide: MEMBER_REPOSITORY, useValue: members },
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

    describe('backwork permission (2026-11-05)', () => {
      const resource = { id: 'bw-1', chapter_id: 'ch-1', title: 'Midterm 2' };

      it('leaves backwork out for a caller with neither backwork:upload nor backwork:admin', async () => {
        repo.searchBackwork.mockResolvedValue([resource]);
        mockRbacService.memberHasAnyPermission.mockResolvedValue(false);

        const result = await service.search('ch-1', 'user-1', 'midterm');

        expect(result.backwork).toEqual([]);
        // Not fetched and dropped: the scan never runs for such a caller.
        expect(repo.searchBackwork).not.toHaveBeenCalled();
        expect(mockRbacService.memberHasAnyPermission).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          ['backwork:upload', 'backwork:admin'],
        );
      });

      it('lists backwork for a caller holding either permission', async () => {
        repo.searchBackwork.mockResolvedValue([resource]);
        mockRbacService.memberHasAnyPermission.mockImplementation(
          async (_c: string, _u: string, permissions: string[]) =>
            permissions.includes('backwork:admin'),
        );

        const result = await service.search('ch-1', 'user-1', 'midterm');

        expect(result.backwork).toEqual([resource]);
      });
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
        channel('gated-yes', 'ROLE_GATED', { who_can_see: [CALLER_TIER] }),
        channel('gated-no', 'ROLE_GATED', { who_can_see: [SECRET_TIER] }),
      ]);
      members.findByUserAndChapter.mockResolvedValue(membership([CALLER_ROLE]));

      // What the caller holds resolves through RbacService from their roles,
      // so who-can-see lists gate search exactly as they gate chat channel
      // access (#3722).
      mockRbacService.getChannelAccessHolder.mockResolvedValue({
        ...EMPTY_ACCESS_HOLDER,
        entries: new Set([`role:${CALLER_ROLE}`, CALLER_TIER]),
      });

      await service.search('ch-1', 'user-1', 'hello');

      expect(mockRbacService.getChannelAccessHolder).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ role_ids: [CALLER_ROLE] }),
        false,
      );
      expect(repo.findChannelsForAccess).toHaveBeenCalledWith(
        'ch-1',
        undefined,
      );
      expect(members.findByUserAndChapter).toHaveBeenCalledWith(
        'user-1',
        'ch-1',
      );
      const [searchedChannelIds] = repo.searchMessages.mock.calls[0] as [
        string[],
      ];
      expect(searchedChannelIds).toEqual(['pub', 'priv-in', 'gated-yes']);
    });

    it('skips the role lookup when no channel has a who-can-see list', async () => {
      repo.findChannelsForAccess.mockResolvedValue([
        channel('pub', 'PUBLIC'),
        channel('priv-in', 'PRIVATE', { member_ids: ['user-1'] }),
      ]);

      await service.search('ch-1', 'user-1', 'hello');

      expect(mockRbacService.getChannelAccessHolder).not.toHaveBeenCalled();
      const [searchedChannelIds] = repo.searchMessages.mock.calls[0] as [
        string[],
      ];
      expect(searchedChannelIds).toEqual(['pub', 'priv-in']);
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
        await service.searchWithinBudget('ch-1', 'user-1', 'hello', {
          channelId: PUB2,
        });

        // The whole point: the narrowing reaches SQL. Filtering client-side
        // would be wrong, because SEARCH_LIMIT is applied by the database
        // across every accessible channel before any client sees a row.
        expect(repo.searchMessages).toHaveBeenCalledWith([PUB2], 'hello', 10);
      });

      it('passes the channel id down as the candidate narrowing', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', 'hello', {
          channelId: PUB2,
        });

        expect(repo.findChannelsForAccess).toHaveBeenCalledWith('ch-1', PUB2);
      });

      it('returns nothing for a channel the caller cannot read, without a 403', async () => {
        const { results: result } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hello',
          { channelId: PRIV_OUT },
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
          { channelId: UNKNOWN_ID },
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
          { channelId: 'general' },
        );

        expect(repo.searchMessages).not.toHaveBeenCalled();
        expect(results.messages).toEqual([]);
      });

      it('runs only the message source, leaving the other three empty', async () => {
        const { results: result } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hello',
          { channelId: PUB },
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
          { channelId: PUB },
        );

        noRepoCalls();
        expect(result.messages).toEqual([]);
      });
    });

    /**
     * #3958. Sender, date and content filters narrow the message source. They
     * are handed to the repository BESIDE the accessible channel ids, so the
     * invariant these pin is that no filter value changes which channels are
     * searched: `spec/behavior/chat/README.md` § Channel-access enforcement.
     */
    describe('message filters (#3958)', () => {
      const PUB = '11111111-1111-4111-8111-111111111111';
      const PRIV_IN = '22222222-2222-4222-8222-222222222222';
      const PRIV_OUT = '33333333-3333-4333-8333-333333333333';
      const GATED_NO = '44444444-4444-4444-8444-444444444444';
      const DM_OTHERS = '55555555-5555-4555-8555-555555555555';
      const SENDER = '99999999-9999-4999-8999-999999999999';
      const READABLE = [PUB, PRIV_IN];

      beforeEach(() => {
        repo.findChannelsForAccess.mockResolvedValue([
          channel(PUB, 'PUBLIC'),
          channel(PRIV_IN, 'PRIVATE', { member_ids: ['user-1'] }),
          channel(PRIV_OUT, 'PRIVATE', { member_ids: [SENDER] }),
          channel(GATED_NO, 'ROLE_GATED', { who_can_see: [SECRET_TIER] }),
          channel(DM_OTHERS, 'DM', { member_ids: [SENDER, 'user-3'] }),
        ]);
      });

      const searchedChannels = () =>
        (repo.searchMessages.mock.calls[0] as [string[]])[0];

      it.each([
        ['fromUserId', { fromUserId: SENDER }],
        ['after', { after: '2026-11-01T00:00:00.000Z' }],
        ['before', { before: '2026-11-08T00:00:00.000Z' }],
        ['has', { has: ['file'] as const }],
        [
          'every filter at once',
          {
            fromUserId: SENDER,
            after: '2026-11-01T00:00:00.000Z',
            before: '2026-11-08T00:00:00.000Z',
            has: ['image', 'link', 'poll'] as const,
          },
        ],
      ])(
        '%s searches only the channels the caller can read',
        async (_, filters) => {
          await service.searchWithinBudget('ch-1', 'user-1', 'hello', filters);

          // The sender is in PRIV_OUT and DM_OTHERS; filtering by them must not
          // bring either channel in.
          expect(searchedChannels()).toEqual(READABLE);
          expect(repo.searchMessages).toHaveBeenCalledWith(
            READABLE,
            'hello',
            10,
            filters,
          );
        },
      );

      it.each([PRIV_OUT, GATED_NO, DM_OTHERS])(
        'a filter beside an unreadable channelId (%s) still returns nothing',
        async (channelId) => {
          const { results } = await service.searchWithinBudget(
            'ch-1',
            'user-1',
            '',
            { channelId, fromUserId: SENDER, has: ['file'] },
          );

          expect(repo.searchMessages).not.toHaveBeenCalled();
          expect(results.messages).toEqual([]);
        },
      );

      it('combines a channel with a filter inside the accessible set', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', 'hello', {
          channelId: PRIV_IN,
          fromUserId: SENDER,
        });

        expect(repo.searchMessages).toHaveBeenCalledWith(
          [PRIV_IN],
          'hello',
          10,
          { fromUserId: SENDER },
        );
      });

      it('searches nothing for a caller with no membership, filter or not', async () => {
        members.findByUserAndChapter.mockResolvedValue(null);

        const { results } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          '',
          { fromUserId: SENDER },
        );

        expect(repo.searchMessages).not.toHaveBeenCalled();
        expect(results.messages).toEqual([]);
      });

      it('runs a filter with no text', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', '   ', {
          fromUserId: SENDER,
        });

        expect(repo.searchMessages).toHaveBeenCalledWith(READABLE, '', 10, {
          fromUserId: SENDER,
        });
      });

      it('still refuses one or two characters, filter or not', async () => {
        const { results } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hi',
          { fromUserId: SENDER },
        );

        noRepoCalls();
        expect(results.messages).toEqual([]);
      });

      it('refuses no text with only a channel: that is the timeline, not a search', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', '', {
          channelId: PUB,
          has: [],
        });

        noRepoCalls();
      });

      it('runs only the message source', async () => {
        await service.searchWithinBudget('ch-1', 'user-1', 'hello', {
          has: ['link'],
        });

        expect(repo.searchBackwork).not.toHaveBeenCalled();
        expect(repo.searchEvents).not.toHaveBeenCalled();
        expect(repo.searchMembers).not.toHaveBeenCalled();
      });

      it('returns nothing for a sender id that is not a uuid, without querying', async () => {
        const { results } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          'hello',
          { fromUserId: "x' or 1=1" },
        );

        noRepoCalls();
        expect(results.messages).toEqual([]);
      });

      it('still masks a blocked sender when filtering by them', async () => {
        repo.searchMessages.mockResolvedValue([
          {
            id: 'm-1',
            channel_id: PUB,
            sender_id: SENDER,
            content: 'the secret',
          },
        ]);
        mockChatBlocks.listBlockedUserIds.mockResolvedValue([SENDER]);

        const { results } = await service.searchWithinBudget(
          'ch-1',
          'user-1',
          '',
          { fromUserId: SENDER },
        );

        expect(results.messages[0]).toMatchObject({
          content: BLOCKED_MESSAGE_CONTENT,
          sender_blocked: true,
        });
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
        members.findByUserAndChapter.mockResolvedValue(membership());
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
      members.findByUserAndChapter.mockResolvedValue(null);

      const result = await service.search('ch-1', 'outsider', 'hello');

      expect(result.messages).toEqual([]);
      expect(repo.searchMessages).not.toHaveBeenCalled();
      expect(mockRbacService.getChannelAccessHolder).not.toHaveBeenCalled();
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
        others_invited: false,
      };

      it('drops a role-targeted event for a viewer without a matching role', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        members.findByUserAndChapter.mockResolvedValue(
          membership(['role-member']),
        );

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(members.findByUserAndChapter).toHaveBeenCalledWith(
          'user-1',
          'ch-1',
        );
        expect(result.events).toEqual([]);
      });

      it('drops a role-targeted event for a caller with no membership', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        members.findByUserAndChapter.mockResolvedValue(null);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toEqual([]);
      });

      it('keeps a role-targeted event for a viewer with a matching role', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        members.findByUserAndChapter.mockResolvedValue(
          membership(['role-officer']),
        );

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(result.events[0].id).toBe('ev-targeted');
      });

      it('keeps a role-targeted event for a viewer holding events:update, regardless of role', async () => {
        repo.searchEvents.mockResolvedValue([targetedEvent]);
        members.findByUserAndChapter.mockResolvedValue(
          membership(['role-member']),
        );
        mockRbacService.memberHasAnyPermission.mockResolvedValue(true);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(mockRbacService.memberHasAnyPermission).toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          expect.arrayContaining(['events:update']),
        );
        // The events:update check short-circuits before the role lookup.
        expect(members.findByUserAndChapter).not.toHaveBeenCalled();
      });

      it('does not look up roles at all when no matched event is role-targeted', async () => {
        const untargeted = {
          ...targetedEvent,
          required_role_ids: null,
          others_invited: true,
        };
        repo.searchEvents.mockResolvedValue([untargeted]);

        const result = await service.search('ch-1', 'user-1', 'exec');

        expect(result.events).toHaveLength(1);
        expect(mockRbacService.memberHasAnyPermission).not.toHaveBeenCalledWith(
          'ch-1',
          'user-1',
          expect.arrayContaining(['events:update']),
        );
        expect(members.findByUserAndChapter).not.toHaveBeenCalled();
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

    it('reports a late failure to Sentry once, while the caller still gets the fallback', async () => {
      jest.useFakeTimers();
      captureException.mockClear();
      const logged = jest
        .spyOn(Logger.prototype, 'error')
        .mockImplementation(() => undefined);
      try {
        wireSources();
        repo.searchBackwork.mockImplementation(() => failingAfter(1_000));

        const promise = service.searchWithinBudget('ch-1', 'user-1', 'meeting');
        await jest.advanceTimersByTimeAsync(500);
        const outcome = await promise;
        expect(outcome.results.backwork).toEqual([]);
        expect(captureException).not.toHaveBeenCalled();

        await jest.advanceTimersByTimeAsync(1_000);
        expect(captureException).toHaveBeenCalledTimes(1);
        expect(captureException.mock.calls[0]?.[1]).toMatchObject({
          level: 'error',
          tags: { caught_at: 'search-source-late-failure:backwork' },
        });
        expect(
          (
            captureException.mock.calls[0]?.[1] as { fingerprint: string[] }
          ).fingerprint.slice(0, 2),
        ).toEqual(['caught-failure', 'search-source-late-failure:backwork']);
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

/**
 * The cap end to end, through the real repository (#3265): a chapter-wide
 * search for a member who can read 250 channels goes out as several
 * channel batches, and what `SearchService` returns is still the newest
 * `SEARCH_LIMIT` (10) matches across all of them.
 */
describe('SearchService — chapter-wide message search over many channels (#3265)', () => {
  const CHANNEL_COUNT = 250;
  const channelId = (chapter: 'a' | 'b', n: number) =>
    `0${chapter}000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

  it('returns the newest ten matches across every readable channel', async () => {
    const channelRow = (id: string) => ({
      id,
      type: 'PUBLIC',
      member_ids: null,
      who_can_see: null,
      who_can_post: null,
    });
    // One match per channel, a minute apart, so the newest ten sit in the
    // last channels — the third batch of 100.
    const messages = Array.from({ length: CHANNEL_COUNT }, (_, n) => ({
      id: `0a000000-0000-4000-9000-${String(n).padStart(12, '0')}`,
      channel_id: channelId('a', n),
      content: 'budget is due',
      content_search: 'budget is due',
      is_deleted: false,
      created_at: new Date(Date.UTC(2026, 2, 1, 0, n)).toISOString(),
    }));
    const harness = createTenantHarness({
      tables: {
        chat_channels: [
          ...Array.from({ length: CHANNEL_COUNT }, (_, n) =>
            inA(channelRow(channelId('a', n))),
          ),
          ...Array.from({ length: CHANNEL_COUNT }, (_, n) =>
            inB(channelRow(channelId('b', n))),
          ),
        ],
        chat_messages: messages,
      },
      untenantedTables: ['chat_messages'],
      parentTenant: {
        chat_messages: { column: 'channel_id', table: 'chat_channels' },
      },
    });
    const repo = new SupabaseSearchRepository(harness.client);
    // Only the message source is under test; the other three stay empty.
    jest.spyOn(repo, 'searchBackwork').mockResolvedValue([]);
    jest.spyOn(repo, 'searchEvents').mockResolvedValue([]);
    jest.spyOn(repo, 'searchMembers').mockResolvedValue([]);
    const searchMessages = jest.spyOn(repo, 'searchMessages');

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SearchService,
        { provide: SEARCH_REPOSITORY, useValue: repo },
        {
          provide: MEMBER_REPOSITORY,
          useValue: {
            findByUserAndChapter: jest
              .fn()
              .mockResolvedValue({ id: 'member-1', role_ids: [] }),
          },
        },
        {
          provide: RbacService,
          useValue: {
            getChannelAccessHolder: jest
              .fn()
              .mockResolvedValue(EMPTY_ACCESS_HOLDER),
            memberHasAnyPermission: jest.fn().mockResolvedValue(false),
          },
        },
        {
          provide: ChatBlockService,
          useValue: { listBlockedUserIds: jest.fn().mockResolvedValue([]) },
        },
      ],
    }).compile();
    const service = module.get(SearchService);

    const { results, timedOut } = await service.searchWithinBudget(
      CHAPTER_A,
      'user-1',
      'budget',
    );

    expect(timedOut).toBe(false);
    expect(searchMessages).toHaveBeenCalledWith(
      Array.from({ length: CHANNEL_COUNT }, (_, n) => channelId('a', n)),
      'budget',
      10,
    );
    expect(results.messages.map((m) => m.id)).toEqual(
      messages
        .slice(-10)
        .reverse()
        .map((m) => m.id),
    );
  });
});
