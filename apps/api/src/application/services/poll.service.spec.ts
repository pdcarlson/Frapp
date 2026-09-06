import { Test, TestingModule } from '@nestjs/testing';
import {
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PollService } from './poll.service';
import { ChannelAccessService } from './channel-access.service';
import { RbacService } from './rbac.service';
import { CHAT_MESSAGE_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '#domain/repositories/chat.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '#domain/repositories/chat.repository.interface';
import type { IChatChannelRepository } from '#domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { POLL_VOTE_REPOSITORY } from '#domain/repositories/poll-vote.repository.interface';
import type { IPollVoteRepository } from '#domain/repositories/poll-vote.repository.interface';
import type { ChatMessage } from '#domain/entities/chat.entity';
import type { ChatChannel } from '#domain/entities/chat.entity';
import type { PollVote } from '#domain/entities/poll-vote.entity';

describe('PollService', () => {
  let service: PollService;
  let mockMessageRepo: jest.Mocked<IChatMessageRepository>;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockVoteRepo: jest.Mocked<IPollVoteRepository>;
  let mockMemberRepo: jest.Mocked<IMemberRepository>;
  let mockRbac: {
    getEffectivePermissions: jest.Mock;
    hasAlumniRole: jest.Mock;
  };
  let loggerErrorSpy: jest.SpyInstance;

  const baseChannel: ChatChannel = {
    id: 'ch-1',
    chapter_id: 'ch-1',
    name: 'general',
    description: null,
    type: 'PUBLIC',
    required_permissions: null,
    member_ids: null,
    category_id: null,
    is_read_only: false,
    created_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  };

  const basePollMessage: ChatMessage = {
    id: 'msg-1',
    channel_id: 'ch-1',
    sender_id: 'user-1',
    content: 'Best meeting time?',
    type: 'POLL',
    reply_to_id: null,
    metadata: {
      question: 'Best meeting time?',
      options: ['Monday', 'Tuesday', 'Wednesday'],
      choice_mode: 'single',
    },
    is_pinned: false,
    pinned_at: null,
    edited_at: null,
    is_deleted: false,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  const baseVote: PollVote = {
    id: 'vote-1',
    message_id: 'msg-1',
    user_id: 'user-2',
    option_index: 1,
    created_at: '2026-01-01T00:00:00.000Z',
  };

  beforeEach(async () => {
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);

    mockMessageRepo = {
      findById: jest.fn(),
      findByChannel: jest.fn(),
      findPinnedByChannel: jest.fn(),
      countPinnedByChannel: jest.fn(),
      findPollsByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    };

    mockChannelRepo = {
      findById: jest.fn(),
      findByChapter: jest.fn(),
      findDm: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      leaveGroupDm: jest.fn(),
    };

    mockVoteRepo = {
      aggregateOptionTotalsByMessages: jest.fn(),
      findUserVotesByMessagesForUser: jest.fn(),
      findByMessageAndUser: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      deleteByMessageAndUser: jest.fn(),
    };

    mockMemberRepo = {
      findById: jest.fn(),
      findByUser: jest.fn(),
      findByUserAndChapter: jest.fn(),
      findByChapter: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    };

    mockRbac = {
      getEffectivePermissions: jest.fn(),
      // Active (non-alumni) member by default; alumni posting is covered in
      // channel-access.service.spec.ts.
      hasAlumniRole: jest.fn().mockResolvedValue(false),
    };

    // Default: caller is a chapter member with no extra permissions, and the
    // chapter's channels are PUBLIC (channel-1 hosts the listPolls fixtures).
    // Individual tests override these to exercise PRIVATE / ROLE_GATED / 404.
    mockMemberRepo.findByUserAndChapter.mockResolvedValue({
      id: 'm-1',
    });
    mockRbac.getEffectivePermissions.mockResolvedValue([]);
    mockChannelRepo.findByChapter.mockResolvedValue([
      { ...baseChannel, id: 'channel-1', type: 'PUBLIC', member_ids: null },
    ]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollService,
        ChannelAccessService,
        {
          provide: CHAT_MESSAGE_REPOSITORY,
          useValue: mockMessageRepo,
        },
        {
          provide: CHAT_CHANNEL_REPOSITORY,
          useValue: mockChannelRepo,
        },
        {
          provide: POLL_VOTE_REPOSITORY,
          useValue: mockVoteRepo,
        },
        {
          provide: MEMBER_REPOSITORY,
          useValue: mockMemberRepo,
        },
        {
          provide: RbacService,
          useValue: mockRbac,
        },
      ],
    }).compile();

    service = module.get(PollService);
  });

  afterEach(() => {
    loggerErrorSpy.mockRestore();
  });

  describe('createPoll', () => {
    it('should create a poll message', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue(basePollMessage);

      const result = await service.createPoll({
        channelId: 'ch-1',
        chapterId: 'ch-1',
        senderId: 'user-1',
        question: 'Best meeting time?',
        options: ['Monday', 'Tuesday', 'Wednesday'],
      });

      expect(result.type).toBe('POLL');
      expect(result.metadata).toMatchObject({
        question: 'Best meeting time?',
        options: ['Monday', 'Tuesday', 'Wednesday'],
        choice_mode: 'single',
      });
    });

    it('should reject when channel not found', async () => {
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.createPoll({
          channelId: 'ch-x',
          chapterId: 'ch-1',
          senderId: 'user-1',
          question: 'Q?',
          options: ['A', 'B'],
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('should reject when options count is less than 2', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.createPoll({
          channelId: 'ch-1',
          chapterId: 'ch-1',
          senderId: 'user-1',
          question: 'Q?',
          options: ['A'],
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when options count exceeds 10', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.createPoll({
          channelId: 'ch-1',
          chapterId: 'ch-1',
          senderId: 'user-1',
          question: 'Q?',
          options: Array(11).fill('Option'),
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should create poll with expiration and multi-choice', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.create.mockResolvedValue({
        ...basePollMessage,
        metadata: {
          question: 'Q?',
          options: ['A', 'B'],
          expires_at: '2026-12-31T23:59:59Z',
          choice_mode: 'multi',
        },
      });

      const result = await service.createPoll({
        channelId: 'ch-1',
        chapterId: 'ch-1',
        senderId: 'user-1',
        question: 'Q?',
        options: ['A', 'B'],
        expiresAt: '2026-12-31T23:59:59Z',
        choiceMode: 'multi',
      });

      expect(result.metadata).toMatchObject({
        expires_at: '2026-12-31T23:59:59Z',
        choice_mode: 'multi',
      });
    });
  });

  describe('vote', () => {
    it('should cast single-choice vote', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.deleteByMessageAndUser.mockResolvedValue();
      mockVoteRepo.create.mockResolvedValue(baseVote);

      await service.vote('msg-1', 'user-2', 'ch-1', [1]);

      expect(mockVoteRepo.deleteByMessageAndUser).toHaveBeenCalledWith(
        'msg-1',
        'user-2',
      );
      expect(mockVoteRepo.create).toHaveBeenCalledWith({
        message_id: 'msg-1',
        user_id: 'user-2',
        option_index: 1,
      });
    });

    it('should reject vote on expired poll', async () => {
      const expiredPoll = {
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          expires_at: '2020-01-01T00:00:00Z',
        },
      };
      mockMessageRepo.findById.mockResolvedValue(expiredPoll);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [0]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject vote on non-poll message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        type: 'TEXT',
      });
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [0]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid option index', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [99]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject multiple options for single-choice poll', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [0, 1]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should replace multi-choice votes with one bulk delete', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          choice_mode: 'multi',
        },
      });
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.deleteByMessageAndUser.mockResolvedValue();
      mockVoteRepo.createMany.mockResolvedValue([
        { ...baseVote, option_index: 0 },
        { ...baseVote, option_index: 2 },
      ]);

      await service.vote('msg-1', 'user-2', 'ch-1', [0, 2]);

      expect(mockVoteRepo.deleteByMessageAndUser).toHaveBeenCalledWith(
        'msg-1',
        'user-2',
      );
      expect(mockVoteRepo.findByMessageAndUser).not.toHaveBeenCalled();
      expect(mockVoteRepo.createMany).toHaveBeenCalledWith([
        {
          message_id: 'msg-1',
          user_id: 'user-2',
          option_index: 0,
        },
        {
          message_id: 'msg-1',
          user_id: 'user-2',
          option_index: 2,
        },
      ]);
      expect(mockVoteRepo.createMany).toHaveBeenCalledTimes(1);
    });
  });

  describe('removeVote', () => {
    it('should remove user vote', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.deleteByMessageAndUser.mockResolvedValue();

      await service.removeVote('msg-1', 'user-2', 'ch-1');

      expect(mockVoteRepo.deleteByMessageAndUser).toHaveBeenCalledWith(
        'msg-1',
        'user-2',
      );
    });

    it('should reject remove vote on expired poll', async () => {
      const expiredPoll = {
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          expires_at: '2020-01-01T00:00:00Z',
        },
      };
      mockMessageRepo.findById.mockResolvedValue(expiredPoll);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.removeVote('msg-1', 'user-2', 'ch-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('vote on a manually closed poll', () => {
    it('rejects with the same message an expired poll would, even with time left before expires_at', async () => {
      const closedPoll = {
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          expires_at: '2099-01-01T00:00:00Z',
          closed_at: '2026-01-02T00:00:00Z',
          closed_by: 'user-1',
        },
      };
      mockMessageRepo.findById.mockResolvedValue(closedPoll);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [0]),
      ).rejects.toThrow(BadRequestException);
      expect(mockVoteRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('close', () => {
    it('lets the creator close an open poll, stamping closed_at and closed_by', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.update.mockResolvedValue({
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          closed_at: '2026-01-01T00:00:00.000Z',
          closed_by: 'user-1',
        },
      });

      await service.close('msg-1', 'user-1', 'ch-1');

      expect(mockMessageRepo.update).toHaveBeenCalledWith(
        'msg-1',
        expect.objectContaining({
          metadata: expect.objectContaining({
            question: basePollMessage.metadata.question,
            closed_at: expect.any(String),
            closed_by: 'user-1',
          }),
        }),
      );
    });

    it('rejects a non-creator with 403', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(service.close('msg-1', 'user-2', 'ch-1')).rejects.toThrow(
        ForbiddenException,
      );
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('rejects closing an already-expired poll', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          expires_at: '2020-01-01T00:00:00Z',
        },
      });
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(service.close('msg-1', 'user-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('rejects closing an already-closed poll, distinctly from an already-expired one', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          closed_at: '2026-01-01T00:00:00.000Z',
          closed_by: 'user-1',
        },
      });
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(service.close('msg-1', 'user-1', 'ch-1')).rejects.toThrow(
        'Poll is already closed',
      );
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('rejects closing a deleted poll, never resurrecting its metadata', async () => {
      // Mirrors editMessage's guard: deletion is soft (metadata wiped to {})
      // but the row stays reachable by id, so without this check close()
      // would spread the pre-delete metadata it just read straight back in.
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        is_deleted: true,
        content: '[message deleted]',
        metadata: {},
      });
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(service.close('msg-1', 'user-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });

    it('rejects closing a non-poll message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        type: 'TEXT',
      });
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(service.close('msg-1', 'user-1', 'ch-1')).rejects.toThrow(
        BadRequestException,
      );
    });

    it('rejects when the poll message does not exist', async () => {
      mockMessageRepo.findById.mockResolvedValue(null);

      await expect(service.close('msg-1', 'user-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
    });

    it('404 when the channel does not resolve within the chapter', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(service.close('msg-1', 'user-1', 'ch-1')).rejects.toThrow(
        NotFoundException,
      );
      expect(mockMessageRepo.update).not.toHaveBeenCalled();
    });
  });

  describe('announceExpiry', () => {
    it('posts a system_audit message into the poll channel', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockMessageRepo.create.mockResolvedValue(basePollMessage);

      await service.announceExpiry('msg-1', 'chan-1', 'Pizza or tacos?');

      expect(mockMessageRepo.create).toHaveBeenCalledWith({
        channel_id: 'chan-1',
        sender_id: '00000000-0000-0000-0000-000000000000',
        content: 'Poll "Pizza or tacos?" has closed.',
        kind: 'system_audit',
      });
    });

    // Sweep's candidate list is a point-in-time snapshot; the creator can
    // manually close() the same poll before this call runs. Without a
    // fresh re-check, that would post a spurious auto notice alongside
    // the manual close.
    it('skips posting when the poll was manually closed since the sweep snapshot', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        metadata: {
          ...basePollMessage.metadata,
          closed_at: '2026-01-01T00:00:00.000Z',
          closed_by: 'user-1',
        },
      });

      await service.announceExpiry('msg-1', 'chan-1', 'Pizza or tacos?');

      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });
  });

  describe('getPoll', () => {
    it('should return poll with results and user votes', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([
        { message_id: 'msg-1', option_index: 0, vote_count: 2 },
        { message_id: 'msg-1', option_index: 1, vote_count: 1 },
      ]);
      mockVoteRepo.findByMessageAndUser.mockResolvedValue([
        { ...baseVote, option_index: 1 },
      ]);

      const result = await service.getPoll('msg-1', 'ch-1', 'user-2');

      // An option the RPC returns no row for is 0, not absent: `GROUP BY`
      // emits nothing for an option nobody picked, so "Wednesday" only ever
      // reaches the client through the `?? 0` default.
      expect(result.results).toEqual([
        { optionIndex: 0, optionText: 'Monday', voteCount: 2 },
        { optionIndex: 1, optionText: 'Tuesday', voteCount: 1 },
        { optionIndex: 2, optionText: 'Wednesday', voteCount: 0 },
      ]);
      expect(result.userVotes).toEqual([1]);
      expect(result.isExpired).toBe(false);
    });

    it('tallies in the database rather than reading vote rows back', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);
      mockVoteRepo.findByMessageAndUser.mockResolvedValue([]);

      await service.getPoll('msg-1', 'ch-1', 'user-2');

      // #568: the detail view used to load every `poll_votes` row and filter
      // it once per option. It must ask for exactly this poll's totals — a
      // wider id list would tally other polls' votes into this one.
      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        ['msg-1'],
      );
    });

    it('ignores totals belonging to another poll', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([
        { message_id: 'msg-1', option_index: 0, vote_count: 2 },
        // The RPC takes a list and groups by message id. Nothing but the call
        // site keeps this to one poll, so the tally must scope rather than
        // trust it — otherwise a widened id list adds a stranger's votes here.
        { message_id: 'msg-other', option_index: 0, vote_count: 99 },
      ]);
      mockVoteRepo.findByMessageAndUser.mockResolvedValue([]);

      const result = await service.getPoll('msg-1', 'ch-1', 'user-2');

      expect(result.results[0]).toEqual({
        optionIndex: 0,
        optionText: 'Monday',
        voteCount: 2,
      });
    });

    it('propagates an aggregate failure rather than reporting every option at zero', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockRejectedValue(
        new Error('boom'),
      );
      // Stubbed even though `Promise.all` rejects on the other read first:
      // leaving it undefined would make this pass for the wrong reason if the
      // two reads were ever resequenced.
      mockVoteRepo.findByMessageAndUser.mockResolvedValue([]);

      // Deliberately unlike `listPolls`, which degrades to zero tallies to keep
      // the list rendering. On a detail view that is indistinguishable from a
      // real result, so the error surfaces as it did when this read rows.
      await expect(service.getPoll('msg-1', 'ch-1', 'user-2')).rejects.toThrow(
        'boom',
      );
    });

    it('propagates a user-vote failure rather than reporting the caller as not having voted', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([
        { message_id: 'msg-1', option_index: 0, vote_count: 2 },
      ]);
      mockVoteRepo.findByMessageAndUser.mockRejectedValue(new Error('boom'));

      // The other half of the divergence from `listPolls`: an empty `userVotes`
      // is indistinguishable from "this member has not voted yet", which is
      // what the vote button renders off.
      await expect(service.getPoll('msg-1', 'ch-1', 'user-2')).rejects.toThrow(
        'boom',
      );
    });

    it('tallies a poll whose id reaches the route in non-canonical case', async () => {
      // Regression: the tally is keyed on the id the database returned, never
      // on the route parameter. `polls/:messageId` has no `ParseUUIDPipe`, and
      // Postgres compares `uuid` case-insensitively while PostgREST renders it
      // canonically lower-case — so an upper-case id matches the row in
      // `findById` and matches the votes in the RPC, then arrives back
      // lower-cased. Comparing it to the raw parameter dropped every row and
      // rendered a real poll as every option at zero.
      const canonicalId = '0848ac98-f67e-4dfe-b3df-03cc47c0a9af';
      const routeId = canonicalId.toUpperCase();
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        id: canonicalId,
      });
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([
        { message_id: canonicalId, option_index: 0, vote_count: 2 },
        { message_id: canonicalId, option_index: 1, vote_count: 1 },
      ]);
      mockVoteRepo.findByMessageAndUser.mockResolvedValue([]);

      const result = await service.getPoll(routeId, 'ch-1', 'user-2');

      // Both reads go out under the database's spelling of the id, not the URL's.
      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        [canonicalId],
      );
      expect(mockVoteRepo.findByMessageAndUser).toHaveBeenCalledWith(
        canonicalId,
        'user-2',
      );
      expect(result.results).toEqual([
        { optionIndex: 0, optionText: 'Monday', voteCount: 2 },
        { optionIndex: 1, optionText: 'Tuesday', voteCount: 1 },
        { optionIndex: 2, optionText: 'Wednesday', voteCount: 0 },
      ]);
    });

    it('should throw NotFoundException when poll not found', async () => {
      mockMessageRepo.findById.mockResolvedValue(null);

      await expect(service.getPoll('msg-x', 'ch-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('listPolls', () => {
    const futureIso = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const pastIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();

    const activePoll: ChatMessage = {
      id: 'poll-active',
      chapter_id: 'ch-1',
      channel_id: 'channel-1',
      sender_id: 'user-1',
      content: 'Meeting night?',
      type: 'POLL',
      reply_to_id: null,
      metadata: {
        question: 'Meeting night?',
        options: ['Monday', 'Tuesday'],
        choice_mode: 'single',
        expires_at: futureIso,
      },
      is_pinned: false,
      pinned_at: null,
      edited_at: null,
      is_deleted: false,
      created_at: '2026-01-02T00:00:00.000Z',
    };

    const expiredPoll: ChatMessage = {
      ...activePoll,
      id: 'poll-expired',
      created_at: '2026-01-01T00:00:00.000Z',
      metadata: {
        question: 'T-shirt colour?',
        options: ['Blue', 'Red'],
        choice_mode: 'single',
        expires_at: pastIso,
      },
    };

    it('returns every poll for the chapter with aggregate vote counts', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([
        activePoll,
        expiredPoll,
      ]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([
        { message_id: 'poll-active', option_index: 0, vote_count: 2 },
        { message_id: 'poll-active', option_index: 1, vote_count: 1 },
      ]);

      const result = await service.listPolls('ch-1');

      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        ['poll-active', 'poll-expired'],
      );
      expect(
        mockVoteRepo.findUserVotesByMessagesForUser,
      ).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('poll-active');
      expect(result[0].results).toEqual([
        { optionIndex: 0, optionText: 'Monday', voteCount: 2 },
        { optionIndex: 1, optionText: 'Tuesday', voteCount: 1 },
      ]);
      expect(result[0].isExpired).toBe(false);
      expect(result[1].isExpired).toBe(true);
    });

    it('loads vote aggregates in one RPC for many polls (no per-poll vote queries)', async () => {
      const manyPolls = Array.from({ length: 50 }, (_, i) => ({
        ...activePoll,
        id: `poll-${i}`,
      }));
      mockMessageRepo.findPollsByChapter.mockResolvedValue(manyPolls);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);

      await service.listPolls('ch-1');

      expect(
        mockVoteRepo.aggregateOptionTotalsByMessages,
      ).toHaveBeenCalledTimes(1);
      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        manyPolls.map((p) => p.id),
      );
      // The row-loading `findByMessage`/`findByMessages` this used to also
      // assert against are gone from the port entirely (#568), so that half of
      // the regression is now a compile error rather than a test failure.
      expect(mockVoteRepo.findByMessageAndUser).not.toHaveBeenCalled();
    });

    it('filters to active=true (expired polls excluded)', async () => {
      // Repository applies active/expired before limit; service does not re-filter.
      mockMessageRepo.findPollsByChapter.mockResolvedValue([activePoll]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);

      const result = await service.listPolls('ch-1', { active: true });

      expect(result.map((p) => p.id)).toEqual(['poll-active']);
      expect(mockMessageRepo.findPollsByChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ active: true }),
      );
    });

    it('filters to active=false (only expired polls)', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([expiredPoll]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);

      const result = await service.listPolls('ch-1', { active: false });

      expect(result.map((p) => p.id)).toEqual(['poll-expired']);
      expect(mockMessageRepo.findPollsByChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ active: false }),
      );
    });

    it('includes userVotes when a userId is supplied', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([activePoll]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);
      mockVoteRepo.findUserVotesByMessagesForUser.mockResolvedValue([
        { message_id: 'poll-active', option_index: 1 },
      ]);

      const result = await service.listPolls('ch-1', { userId: 'user-2' });

      expect(result[0].userVotes).toEqual([1]);
      expect(mockVoteRepo.findUserVotesByMessagesForUser).toHaveBeenCalledWith(
        ['poll-active'],
        'user-2',
      );
      expect(mockVoteRepo.findByMessageAndUser).not.toHaveBeenCalled();
    });

    it('clamps limit to the 1–200 range before calling the repository', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);

      await service.listPolls('ch-1', { limit: 0 });
      expect(mockMessageRepo.findPollsByChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ limit: 1 }),
      );

      await service.listPolls('ch-1', { limit: 9999 });
      expect(mockMessageRepo.findPollsByChapter).toHaveBeenLastCalledWith(
        'ch-1',
        expect.objectContaining({ limit: 200 }),
      );
    });

    it('logs when the batched vote aggregation fails and returns zero tallies', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([activePoll]);
      const batchError = new Error('postgrest timeout');
      mockVoteRepo.aggregateOptionTotalsByMessages.mockRejectedValue(
        batchError,
      );

      const result = await service.listPolls('chapter-xyz');

      expect(result).toHaveLength(1);
      expect(result[0].results.every((r) => r.voteCount === 0)).toBe(true);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('chapter-xyz'),
        expect.stringContaining('postgrest timeout'),
      );
    });
  });

  describe('channel-access enforcement', () => {
    const privateChannel: ChatChannel = {
      ...baseChannel,
      id: 'ch-private',
      type: 'PRIVATE',
      member_ids: ['other-user'],
    };

    const roleGatedChannel: ChatChannel = {
      ...baseChannel,
      id: 'ch-role',
      type: 'ROLE_GATED',
      member_ids: null,
      required_permissions: ['secret:view'],
    };

    const privatePoll: ChatMessage = {
      ...basePollMessage,
      channel_id: 'ch-private',
    };

    const roleGatedPoll: ChatMessage = {
      ...basePollMessage,
      channel_id: 'ch-role',
    };

    it('createPoll → 403 when the caller cannot post to the channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(privateChannel);

      await expect(
        service.createPoll({
          channelId: 'ch-private',
          chapterId: 'ch-1',
          senderId: 'user-1',
          question: 'Q?',
          options: ['A', 'B'],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('vote → 403 when the caller cannot access the channel', async () => {
      mockMessageRepo.findById.mockResolvedValue(privatePoll);
      mockChannelRepo.findById.mockResolvedValue(privateChannel);

      await expect(
        service.vote('msg-1', 'user-1', 'ch-1', [0]),
      ).rejects.toThrow(ForbiddenException);
      expect(mockVoteRepo.create).not.toHaveBeenCalled();
    });

    it('vote → 404 when the poll channel does not resolve within the chapter', async () => {
      mockMessageRepo.findById.mockResolvedValue(privatePoll);
      mockChannelRepo.findById.mockResolvedValue(null);

      await expect(
        service.vote('msg-1', 'user-1', 'ch-1', [0]),
      ).rejects.toThrow(NotFoundException);
    });

    it('removeVote → 403 when the caller cannot access the channel', async () => {
      mockMessageRepo.findById.mockResolvedValue(privatePoll);
      mockChannelRepo.findById.mockResolvedValue(privateChannel);

      await expect(
        service.removeVote('msg-1', 'user-1', 'ch-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockVoteRepo.deleteByMessageAndUser).not.toHaveBeenCalled();
    });

    it('getPoll → 403 when the caller cannot read the channel', async () => {
      mockMessageRepo.findById.mockResolvedValue(privatePoll);
      mockChannelRepo.findById.mockResolvedValue(privateChannel);

      await expect(service.getPoll('msg-1', 'ch-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('getPoll → allowed for a ROLE_GATED channel when the caller holds the permission', async () => {
      mockMessageRepo.findById.mockResolvedValue(roleGatedPoll);
      mockChannelRepo.findById.mockResolvedValue(roleGatedChannel);
      mockRbac.getEffectivePermissions.mockResolvedValue(['secret:view']);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);
      mockVoteRepo.findByMessageAndUser.mockResolvedValue([]);

      const result = await service.getPoll('msg-1', 'ch-1', 'user-1');

      expect(result.id).toBe('msg-1');
    });

    it('getPoll → 403 for a ROLE_GATED channel when the caller lacks the permission', async () => {
      mockMessageRepo.findById.mockResolvedValue(roleGatedPoll);
      mockChannelRepo.findById.mockResolvedValue(roleGatedChannel);
      mockRbac.getEffectivePermissions.mockResolvedValue([]);

      await expect(service.getPoll('msg-1', 'ch-1', 'user-1')).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('listPolls excludes polls in channels the caller cannot read', async () => {
      const visiblePoll: ChatMessage = {
        ...basePollMessage,
        id: 'poll-visible',
        channel_id: 'channel-1',
      };
      const hiddenPoll: ChatMessage = {
        ...basePollMessage,
        id: 'poll-hidden',
        channel_id: 'channel-2',
      };
      mockMessageRepo.findPollsByChapter.mockResolvedValue([
        visiblePoll,
        hiddenPoll,
      ]);
      mockChannelRepo.findByChapter.mockResolvedValue([
        { ...baseChannel, id: 'channel-1', type: 'PUBLIC', member_ids: null },
        {
          ...baseChannel,
          id: 'channel-2',
          type: 'PRIVATE',
          member_ids: ['other-user'],
        },
      ]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);

      const result = await service.listPolls('ch-1', { userId: 'user-1' });

      expect(result.map((p) => p.id)).toEqual(['poll-visible']);
      // The hidden poll's votes are never even aggregated.
      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        ['poll-visible'],
      );
    });

    it('listPolls returns nothing when the caller is not a chapter member', async () => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue(null);
      mockMessageRepo.findPollsByChapter.mockResolvedValue([
        { ...basePollMessage, id: 'poll-1', channel_id: 'channel-1' },
      ]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([]);

      const result = await service.listPolls('ch-1', { userId: 'ghost' });

      expect(result).toEqual([]);
    });
  });

  // Alumni are restricted from *posting*, not from participating. Creating a
  // poll authors a message into the channel; voting does not. These run through
  // the real ChannelAccessService, so they cover the PollService → predicate
  // wiring end to end. See spec/behavior/alumni.md.
  describe('Alumni lifecycle', () => {
    beforeEach(() => {
      mockMemberRepo.findByUserAndChapter.mockResolvedValue({
        id: 'm-1',
        role_ids: ['role-alumni'],
      });
      mockRbac.hasAlumniRole.mockResolvedValue(true);
    });

    it('denies an alumni member creating a poll in a PUBLIC channel', async () => {
      mockChannelRepo.findById.mockResolvedValue(baseChannel);

      await expect(
        service.createPoll({
          channelId: 'channel-1',
          chapterId: 'ch-1',
          senderId: 'user-2',
          question: 'Pick one',
          options: ['a', 'b'],
        }),
      ).rejects.toThrow(ForbiddenException);

      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('still lets an alumni member vote in a poll they can read', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.deleteByMessageAndUser.mockResolvedValue();
      mockVoteRepo.create.mockResolvedValue(baseVote);

      await service.vote('msg-1', 'user-2', 'ch-1', [1]);

      expect(mockVoteRepo.create).toHaveBeenCalled();
    });

    it('still lets an alumni member retract a vote', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockVoteRepo.deleteByMessageAndUser.mockResolvedValue();

      await service.removeVote('msg-1', 'user-2', 'ch-1');

      expect(mockVoteRepo.deleteByMessageAndUser).toHaveBeenCalledWith(
        'msg-1',
        'user-2',
      );
    });

    it('still lets an alumni member close their own open-ended poll', async () => {
      // close() is gated as a `vote`, not a `post`, precisely so this never
      // regresses: an open-ended (no expires_at) poll whose creator later
      // becomes Alumni must stay closeable by them, not get stuck open
      // forever the moment they lose post rights in the channel.
      const ownPoll = { ...basePollMessage, sender_id: 'user-2' };
      mockMessageRepo.findById.mockResolvedValue(ownPoll);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
      mockMessageRepo.update.mockResolvedValue(ownPoll);

      await service.close('msg-1', 'user-2', 'ch-1');

      expect(mockMessageRepo.update).toHaveBeenCalled();
    });
  });
});
