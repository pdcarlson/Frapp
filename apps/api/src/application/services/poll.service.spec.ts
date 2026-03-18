import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { PollService } from './poll.service';
import { CHAT_MESSAGE_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatMessageRepository } from '../../domain/repositories/chat.repository.interface';
import { CHAT_CHANNEL_REPOSITORY } from '../../domain/repositories/chat.repository.interface';
import type { IChatChannelRepository } from '../../domain/repositories/chat.repository.interface';
import { POLL_VOTE_REPOSITORY } from '../../domain/repositories/poll-vote.repository.interface';
import type { IPollVoteRepository } from '../../domain/repositories/poll-vote.repository.interface';
import type { ChatMessage } from '../../domain/entities/chat.entity';
import type { ChatChannel } from '../../domain/entities/chat.entity';
import type { PollVote } from '../../domain/entities/poll-vote.entity';

describe('PollService', () => {
  let service: PollService;
  let mockMessageRepo: jest.Mocked<IChatMessageRepository>;
  let mockChannelRepo: jest.Mocked<IChatChannelRepository>;
  let mockVoteRepo: jest.Mocked<IPollVoteRepository>;

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
    mockMessageRepo = {
      findById: jest.fn(),
      findByChannel: jest.fn(),
      findPinnedByChannel: jest.fn(),
      countPinnedByChannel: jest.fn(),
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
    };

    mockVoteRepo = {
      findByMessage: jest.fn(),
      findByMessageAndUser: jest.fn(),
      create: jest.fn(),
      deleteByMessageAndUser: jest.fn(),
      deleteByMessageUserAndOption: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PollService,
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
      ],
    }).compile();

    service = module.get(PollService);
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
      mockVoteRepo.create.mockResolvedValue(baseVote);

      await service.vote('msg-1', 'user-2', 'ch-1', [0, 2]);

      expect(mockVoteRepo.deleteByMessageAndUser).toHaveBeenCalledWith(
        'msg-1',
        'user-2',
      );
      expect(mockVoteRepo.findByMessageAndUser).not.toHaveBeenCalled();
      expect(mockVoteRepo.create).toHaveBeenNthCalledWith(1, {
        message_id: 'msg-1',
        user_id: 'user-2',
        option_index: 0,
      });
      expect(mockVoteRepo.create).toHaveBeenNthCalledWith(2, {
        message_id: 'msg-1',
        user_id: 'user-2',
        option_index: 2,
      });
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

  describe('getPoll', () => {
    it('should return poll with results and user votes', async () => {
      mockMessageRepo.findById.mockResolvedValue(basePollMessage);
      mockChannelRepo.findById.mockResolvedValue(baseChannel);
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
    });

    it('should throw NotFoundException when poll not found', async () => {
      mockMessageRepo.findById.mockResolvedValue(null);

      await expect(service.getPoll('msg-x', 'ch-1', 'user-2')).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
