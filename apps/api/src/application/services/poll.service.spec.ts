import { Test, TestingModule } from '@nestjs/testing';
import {
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { PollService } from './poll.service';
import { ChannelAccessService } from './channel-access.service';
import { CHAT_MESSAGE_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '../../domain/repositories/chat.repository.interface';
import { POLL_VOTE_REPOSITORY } from '../../domain/repositories/poll-vote.repository.interface';
import type { IPollVoteRepository } from '../../domain/repositories/poll-vote.repository.interface';
import type { ChatMessage } from '../../domain/entities/chat.entity';
import type { ChatChannel } from '../../domain/entities/chat.entity';
import type { PollVote } from '../../domain/entities/poll-vote.entity';

describe('PollService', () => {
  let service: PollService;
  let mockMessageRepo: jest.Mocked<IChatMessageRepository>;
  let mockVoteRepo: jest.Mocked<IPollVoteRepository>;
  let mockChannelAccess: {
    assertAccess: jest.Mock;
    filterAccessibleChannelIds: jest.Mock;
  };
  let loggerErrorSpy: jest.SpyInstance;

  const VIEWER = 'user-2';

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

    mockVoteRepo = {
      findByMessage: jest.fn(),
      findByMessages: jest.fn(),
      aggregateOptionTotalsByMessages: jest.fn().mockResolvedValue([]),
      findUserVotesByMessagesForUser: jest.fn().mockResolvedValue([]),
      findByMessageAndUser: jest.fn(),
      create: jest.fn(),
      createMany: jest.fn(),
      deleteByMessageAndUser: jest.fn(),
      deleteByMessageUserAndOption: jest.fn(),
    };

    mockChannelAccess = {
      // Default: the caller is authorized. Denial paths override these.
      assertAccess: jest.fn().mockResolvedValue(baseChannel),
      filterAccessibleChannelIds: jest
        .fn()
        .mockImplementation(
          async (_chapterId: string, _userId: string, channelIds: string[]) =>
            new Set(channelIds),
        ),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollService,
        {
          provide: CHAT_MESSAGE_REPOSITORY,
          useValue: mockMessageRepo,
        },
        {
          provide: POLL_VOTE_REPOSITORY,
          useValue: mockVoteRepo,
        },
        {
          provide: ChannelAccessService,
          useValue: mockChannelAccess,
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
      // Authorized as a "post" so the read-only gate is enforced too.
      expect(mockChannelAccess.assertAccess).toHaveBeenCalledWith(
        'ch-1',
        'ch-1',
        'user-1',
        'post',
      );
    });

    it('should reject when channel not found (wrong chapter)', async () => {
      mockChannelAccess.assertAccess.mockRejectedValue(
        new NotFoundException('Channel not found'),
      );

      await expect(
        service.createPoll({
          channelId: 'ch-x',
          chapterId: 'ch-1',
          senderId: 'user-1',
          question: 'Q?',
          options: ['A', 'B'],
        }),
      ).rejects.toThrow(NotFoundException);
      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('should reject a sender without access to the channel (403)', async () => {
      mockChannelAccess.assertAccess.mockRejectedValue(
        new ForbiddenException('You do not have access to this channel'),
      );

      await expect(
        service.createPoll({
          channelId: 'ch-private',
          chapterId: 'ch-1',
          senderId: 'outsider',
          question: 'Q?',
          options: ['A', 'B'],
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(mockMessageRepo.create).not.toHaveBeenCalled();
    });

    it('should reject when options count is less than 2', async () => {
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
      // Channel visibility checked as a read (voting is participation).
      expect(mockChannelAccess.assertAccess).toHaveBeenCalledWith(
        'ch-1',
        'ch-1',
        'user-2',
        'read',
      );
    });

    it('should reject a voter without access to the channel (403)', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelAccess.assertAccess.mockRejectedValue(
        new ForbiddenException('You do not have access to this channel'),
      );

      await expect(
        service.vote('msg-1', 'outsider', 'ch-1', [1]),
      ).rejects.toThrow(ForbiddenException);
      expect(mockVoteRepo.create).not.toHaveBeenCalled();
      expect(mockVoteRepo.deleteByMessageAndUser).not.toHaveBeenCalled();
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

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [0]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject vote on non-poll message', async () => {
      mockMessageRepo.findById.mockResolvedValue({
        ...basePollMessage,
        type: 'TEXT',
      });

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [0]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject invalid option index', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);

      await expect(
        service.vote('msg-1', 'user-2', 'ch-1', [99]),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject multiple options for single-choice poll', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);

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
      expect(mockVoteRepo.deleteByMessageUserAndOption).not.toHaveBeenCalled();
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
      mockVoteRepo.deleteByMessageAndUser.mockResolvedValue();

      await service.removeVote('msg-1', 'user-2', 'ch-1');

      expect(mockVoteRepo.deleteByMessageAndUser).toHaveBeenCalledWith(
        'msg-1',
        'user-2',
      );
      expect(mockChannelAccess.assertAccess).toHaveBeenCalledWith(
        'ch-1',
        'ch-1',
        'user-2',
        'read',
      );
    });

    it('should reject a remover without access to the channel (403)', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelAccess.assertAccess.mockRejectedValue(
        new ForbiddenException('You do not have access to this channel'),
      );

      await expect(
        service.removeVote('msg-1', 'outsider', 'ch-1'),
      ).rejects.toThrow(ForbiddenException);
      expect(mockVoteRepo.deleteByMessageAndUser).not.toHaveBeenCalled();
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

      await expect(
        service.removeVote('msg-1', 'user-2', 'ch-1'),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('getPoll', () => {
    it('should return poll with results and user votes', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockVoteRepo.findByMessage.mockResolvedValue([
        { ...baseVote, option_index: 0 },
        { ...baseVote, user_id: 'user-3', option_index: 0 },
        { ...baseVote, option_index: 1 },
      ]);
      mockVoteRepo.findByMessageAndUser.mockResolvedValue([
        { ...baseVote, option_index: 1 },
      ]);

      const result = await service.getPoll('msg-1', 'ch-1', 'user-2');

      expect(result.results).toEqual([
        { optionIndex: 0, optionText: 'Monday', voteCount: 2 },
        { optionIndex: 1, optionText: 'Tuesday', voteCount: 1 },
        { optionIndex: 2, optionText: 'Wednesday', voteCount: 0 },
      ]);
      expect(result.userVotes).toEqual([1]);
      expect(result.isExpired).toBe(false);
      expect(mockChannelAccess.assertAccess).toHaveBeenCalledWith(
        'ch-1',
        'ch-1',
        'user-2',
        'read',
      );
    });

    it('should reject a reader without access to the channel (403)', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelAccess.assertAccess.mockRejectedValue(
        new ForbiddenException('You do not have access to this channel'),
      );

      await expect(
        service.getPoll('msg-1', 'ch-1', 'outsider'),
      ).rejects.toThrow(ForbiddenException);
      // No poll content is read once access is denied.
      expect(mockVoteRepo.findByMessage).not.toHaveBeenCalled();
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

    it('returns chapter polls (in accessible channels) with aggregate vote counts', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([
        activePoll,
        expiredPoll,
      ]);
      mockVoteRepo.aggregateOptionTotalsByMessages.mockResolvedValue([
        { message_id: 'poll-active', option_index: 0, vote_count: 2 },
        { message_id: 'poll-active', option_index: 1, vote_count: 1 },
      ]);

      const result = await service.listPolls('ch-1', { userId: VIEWER });

      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        ['poll-active', 'poll-expired'],
      );
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('poll-active');
      expect(result[0].results).toEqual([
        { optionIndex: 0, optionText: 'Monday', voteCount: 2 },
        { optionIndex: 1, optionText: 'Tuesday', voteCount: 1 },
      ]);
      expect(result[0].isExpired).toBe(false);
      expect(result[1].isExpired).toBe(true);
    });

    it('excludes polls in channels the caller cannot access and skips their tallies', async () => {
      const secretPoll: ChatMessage = {
        ...activePoll,
        id: 'poll-secret',
        channel_id: 'channel-secret',
      };
      mockMessageRepo.findPollsByChapter.mockResolvedValue([
        activePoll,
        secretPoll,
      ]);
      // Caller can read channel-1 but not channel-secret.
      mockChannelAccess.filterAccessibleChannelIds.mockResolvedValue(
        new Set(['channel-1']),
      );

      const result = await service.listPolls('ch-1', { userId: VIEWER });

      expect(result.map((p) => p.id)).toEqual(['poll-active']);
      // Tallies are only fetched for the visible poll — never the hidden one.
      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        ['poll-active'],
      );
      expect(mockChannelAccess.filterAccessibleChannelIds).toHaveBeenCalledWith(
        'ch-1',
        VIEWER,
        ['channel-1', 'channel-secret'],
        'read',
      );
    });

    it('returns [] and skips all reads when no userId is supplied (no principal)', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([activePoll]);

      const result = await service.listPolls('ch-1');

      expect(result).toEqual([]);
      expect(
        mockChannelAccess.filterAccessibleChannelIds,
      ).not.toHaveBeenCalled();
      expect(
        mockVoteRepo.aggregateOptionTotalsByMessages,
      ).not.toHaveBeenCalled();
    });

    it('loads vote aggregates in one RPC for many polls (no per-poll vote queries)', async () => {
      const manyPolls = Array.from({ length: 50 }, (_, i) => ({
        ...activePoll,
        id: `poll-${i}`,
      }));
      mockMessageRepo.findPollsByChapter.mockResolvedValue(manyPolls);

      await service.listPolls('ch-1', { userId: VIEWER });

      expect(
        mockVoteRepo.aggregateOptionTotalsByMessages,
      ).toHaveBeenCalledTimes(1);
      expect(mockVoteRepo.aggregateOptionTotalsByMessages).toHaveBeenCalledWith(
        manyPolls.map((p) => p.id),
      );
      expect(mockVoteRepo.findByMessage).not.toHaveBeenCalled();
      expect(mockVoteRepo.findByMessageAndUser).not.toHaveBeenCalled();
    });

    it('filters to active=true (expired polls excluded)', async () => {
      // Repository applies active/expired before limit; service does not re-filter.
      mockMessageRepo.findPollsByChapter.mockResolvedValue([activePoll]);

      const result = await service.listPolls('ch-1', {
        active: true,
        userId: VIEWER,
      });

      expect(result.map((p) => p.id)).toEqual(['poll-active']);
      expect(mockMessageRepo.findPollsByChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ active: true }),
      );
    });

    it('filters to active=false (only expired polls)', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([expiredPoll]);

      const result = await service.listPolls('ch-1', {
        active: false,
        userId: VIEWER,
      });

      expect(result.map((p) => p.id)).toEqual(['poll-expired']);
      expect(mockMessageRepo.findPollsByChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ active: false }),
      );
    });

    it('includes userVotes when a userId is supplied', async () => {
      mockMessageRepo.findPollsByChapter.mockResolvedValue([activePoll]);
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

      await service.listPolls('ch-1', { limit: 0, userId: VIEWER });
      expect(mockMessageRepo.findPollsByChapter).toHaveBeenCalledWith(
        'ch-1',
        expect.objectContaining({ limit: 1 }),
      );

      await service.listPolls('ch-1', { limit: 9999, userId: VIEWER });
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

      const result = await service.listPolls('chapter-xyz', { userId: VIEWER });

      expect(result).toHaveLength(1);
      expect(result[0].results.every((r) => r.voteCount === 0)).toBe(true);
      expect(loggerErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('chapter-xyz'),
        expect.stringContaining('postgrest timeout'),
      );
    });
  });
});
