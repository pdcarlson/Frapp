import { Test, TestingModule } from '@nestjs/testing';
import { ChapterAuditLogService } from './chapter-audit-log.service';
import {
  CHAPTER_AUDIT_LOG_REPOSITORY,
  type IChapterAuditLogRepository,
} from '../../domain/repositories/chapter-audit-log.repository.interface';

describe('ChapterAuditLogService', () => {
  let service: ChapterAuditLogService;
  let mockRepo: jest.Mocked<IChapterAuditLogRepository>;

  beforeEach(async () => {
    mockRepo = {
      create: jest.fn(),
      findByChapter: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterAuditLogService,
        { provide: CHAPTER_AUDIT_LOG_REPOSITORY, useValue: mockRepo },
      ],
    }).compile();

    service = module.get(ChapterAuditLogService);
  });

  describe('record', () => {
    it('writes an insert-only row scoped to the given chapter', async () => {
      mockRepo.create.mockResolvedValue({
        id: 'audit-1',
        chapter_id: 'chapter-1',
        actor_user_id: 'actor-1',
        action: 'member_removed',
        target_type: 'member',
        target_id: 'member-1',
        scope: 'chapter',
        diff: {},
        member_visible: true,
        created_at: '2026-01-01T00:00:00.000Z',
      });

      await service.record({
        chapterId: 'chapter-1',
        actorUserId: 'actor-1',
        action: 'member_removed',
        targetType: 'member',
        targetId: 'member-1',
        diff: { user_id: 'user-1' },
      });

      expect(mockRepo.create).toHaveBeenCalledWith({
        chapter_id: 'chapter-1',
        actor_user_id: 'actor-1',
        action: 'member_removed',
        target_type: 'member',
        target_id: 'member-1',
        scope: 'chapter',
        diff: { user_id: 'user-1' },
        member_visible: true,
      });
    });

    it('defaults diff to {} and member_visible to true when omitted', async () => {
      mockRepo.create.mockResolvedValue({
        id: 'audit-2',
        chapter_id: 'chapter-1',
        actor_user_id: null,
        action: 'system_action',
        target_type: 'chapter',
        target_id: null,
        scope: 'chapter',
        diff: {},
        member_visible: true,
        created_at: '2026-01-01T00:00:00.000Z',
      });

      await service.record({
        chapterId: 'chapter-1',
        actorUserId: null,
        action: 'system_action',
        targetType: 'chapter',
      });

      expect(mockRepo.create).toHaveBeenCalledWith(
        expect.objectContaining({ diff: {}, member_visible: true }),
      );
    });

    it('propagates a repository failure rather than swallowing it', async () => {
      mockRepo.create.mockRejectedValue(new Error('insert failed'));

      await expect(
        service.record({
          chapterId: 'chapter-1',
          actorUserId: 'actor-1',
          action: 'member_removed',
          targetType: 'member',
        }),
      ).rejects.toThrow('insert failed');
    });
  });

  describe('list', () => {
    it('scopes the read to the given chapter and clamps limit to the default', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', {});

      expect(mockRepo.findByChapter).toHaveBeenCalledWith('chapter-1', {
        before: undefined,
        limit: 50,
      });
    });

    it('clamps an over-large limit to the max', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', { limit: 10_000 });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({ limit: 200 }),
      );
    });

    it('clamps a zero/negative limit up to the min', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', { limit: 0 });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({ limit: 1 }),
      );
    });

    it('normalizes a valid before cursor to an ISO string', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', { before: '2026-01-01T00:00:00Z' });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({ before: '2026-01-01T00:00:00.000Z' }),
      );
    });

    it('drops an unparseable before cursor rather than erroring', async () => {
      mockRepo.findByChapter.mockResolvedValue([]);

      await service.list('chapter-1', { before: 'not-a-date' });

      expect(mockRepo.findByChapter).toHaveBeenCalledWith(
        'chapter-1',
        expect.objectContaining({ before: undefined }),
      );
    });
  });
});
