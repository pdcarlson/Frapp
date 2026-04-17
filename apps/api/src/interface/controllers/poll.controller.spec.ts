import { Test, TestingModule } from '@nestjs/testing';
import { PollController } from './poll.controller';
import { PollService } from '../../application/services/poll.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';
import { CreatePollDto, ListPollsQueryDto, VoteDto } from '../dtos/poll.dto';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { SystemPermissions } from '../../domain/constants/permissions';

describe('PollController', () => {
  let controller: PollController;
  let pollService: jest.Mocked<PollService>;

  beforeEach(async () => {
    pollService = {
      createPoll: jest.fn(),
      vote: jest.fn(),
      removeVote: jest.fn(),
      getPoll: jest.fn(),
      listPolls: jest.fn(),
    } as any;

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PollController],
      providers: [{ provide: PollService, useValue: pollService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<PollController>(PollController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createPoll', () => {
    it('should create a poll', async () => {
      const channelId = 'channel-123';
      const chapterId = 'chapter-123';
      const userId = 'user-123';
      const dto: CreatePollDto = {
        question: 'Test Poll',
        options: ['Option 1', 'Option 2'],
        choice_mode: 'single',
        expires_at: new Date('2099-01-01').toISOString(),
      };
      const expectedMessage = { id: 'msg-123' } as any;

      pollService.createPoll.mockResolvedValue(expectedMessage);

      const result = await controller.createPoll(
        channelId,
        chapterId,
        userId,
        dto,
      );

      expect(pollService.createPoll).toHaveBeenCalledWith({
        channelId,
        chapterId,
        senderId: userId,
        question: dto.question,
        options: dto.options,
        expiresAt: dto.expires_at,
        choiceMode: dto.choice_mode,
      });
      expect(result).toEqual(expectedMessage);
    });
  });

  describe('vote', () => {
    it('should cast a vote with a single option index', async () => {
      const messageId = 'msg-123';
      const chapterId = 'chapter-123';
      const userId = 'user-123';
      const dto: VoteDto = { option_indexes: 1 };

      pollService.vote.mockResolvedValue(undefined);

      const result = await controller.vote(messageId, chapterId, userId, dto);

      expect(pollService.vote).toHaveBeenCalledWith(
        messageId,
        userId,
        chapterId,
        [1],
      );
      expect(result).toEqual({ success: true });
    });

    it('should cast a vote with an array of option indexes', async () => {
      const messageId = 'msg-123';
      const chapterId = 'chapter-123';
      const userId = 'user-123';
      const dto: VoteDto = { option_indexes: [0, 2] };

      pollService.vote.mockResolvedValue(undefined);

      const result = await controller.vote(messageId, chapterId, userId, dto);

      expect(pollService.vote).toHaveBeenCalledWith(
        messageId,
        userId,
        chapterId,
        [0, 2],
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('removeVote', () => {
    it('should remove a vote', async () => {
      const messageId = 'msg-123';
      const chapterId = 'chapter-123';
      const userId = 'user-123';

      pollService.removeVote.mockResolvedValue(undefined);

      const result = await controller.removeVote(messageId, chapterId, userId);

      expect(pollService.removeVote).toHaveBeenCalledWith(
        messageId,
        userId,
        chapterId,
      );
      expect(result).toEqual({ success: true });
    });
  });

  describe('listPolls', () => {
    it('should list polls with query options', async () => {
      const chapterId = 'chapter-123';
      const userId = 'user-123';
      const query: ListPollsQueryDto = {
        channel_id: 'ch-a',
        active: 'true',
        limit: 25,
      };
      const expected = [{ id: 'poll-1' }] as any;

      pollService.listPolls.mockResolvedValue(expected);

      const result = await controller.listPolls(chapterId, userId, query);

      expect(pollService.listPolls).toHaveBeenCalledWith(chapterId, {
        channelId: 'ch-a',
        active: true,
        limit: 25,
        userId,
      });
      expect(result).toEqual(expected);
    });

    it('should require POLLS_VIEW_ALL permission', () => {
      const permissions = Reflect.getMetadata(
        PERMISSIONS_KEY,
        controller.listPolls,
      );
      expect(permissions).toEqual([SystemPermissions.POLLS_VIEW_ALL]);
    });
  });

  describe('getPoll', () => {
    it('should get a poll with results', async () => {
      const messageId = 'msg-123';
      const chapterId = 'chapter-123';
      const userId = 'user-123';
      const expectedPoll = { id: messageId, results: [] } as any;

      pollService.getPoll.mockResolvedValue(expectedPoll);

      const result = await controller.getPoll(messageId, chapterId, userId);

      expect(pollService.getPoll).toHaveBeenCalledWith(
        messageId,
        chapterId,
        userId,
      );
      expect(result).toEqual(expectedPoll);
    });
  });
});
