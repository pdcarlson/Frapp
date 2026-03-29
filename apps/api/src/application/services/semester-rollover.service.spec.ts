import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { SemesterRolloverService } from './semester-rollover.service';
import { SEMESTER_ARCHIVE_REPOSITORY } from '../../domain/repositories/semester-archive.repository.interface';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';
import type { SemesterArchive } from '../../domain/entities/semester-archive.entity';

describe('SemesterRolloverService', () => {
  let service: SemesterRolloverService;
  let mockArchiveRepo: jest.Mocked<ISemesterArchiveRepository>;

  const baseArchive: SemesterArchive = {
    id: 'arch-1',
    chapter_id: 'ch-1',
    label: 'Fall 2025',
    start_date: '2025-08-01',
    end_date: '2025-12-15',
    created_at: '2025-12-16T00:00:00.000Z',
  };

  beforeEach(async () => {
    mockArchiveRepo = {
      findByChapter: jest.fn(),
      findLatestByChapter: jest.fn(),
      create: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SemesterRolloverService,
        {
          provide: SEMESTER_ARCHIVE_REPOSITORY,
          useValue: mockArchiveRepo,
        },
      ],
    }).compile();

    service = module.get(SemesterRolloverService);
  });

  describe('rollover', () => {
    it('should create semester archive when no previous archive exists', async () => {
      mockArchiveRepo.findLatestByChapter.mockResolvedValue(null);
      mockArchiveRepo.create.mockResolvedValue(baseArchive);

      const result = await service.rollover({
        chapterId: 'ch-1',
        label: 'Fall 2025',
        startDate: '2025-08-01',
        endDate: '2025-12-15',
      });

      expect(result).toEqual(baseArchive);
      expect(mockArchiveRepo.create).toHaveBeenCalledWith({
        chapter_id: 'ch-1',
        label: 'Fall 2025',
        start_date: '2025-08-01',
        end_date: '2025-12-15',
      });
    });

    it('should create semester archive when last rollover was in previous month', async () => {
      const lastMonth = new Date();
      lastMonth.setUTCDate(15);
      lastMonth.setUTCMonth(lastMonth.getUTCMonth() - 1);
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: lastMonth.toISOString(),
      });
      mockArchiveRepo.create.mockResolvedValue({
        ...baseArchive,
        id: 'arch-2',
        label: 'Spring 2026',
      });

      const result = await service.rollover({
        chapterId: 'ch-1',
        label: 'Spring 2026',
        startDate: '2026-01-10',
        endDate: '2026-05-15',
      });

      expect(mockArchiveRepo.create).toHaveBeenCalled();
      expect(result.label).toBe('Spring 2026');
    });

    it('should throw ConflictException when rollover already done this month', async () => {
      const thisMonth = new Date();
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: thisMonth.toISOString(),
      });

      await expect(
        service.rollover({
          chapterId: 'ch-1',
          label: 'Spring 2026',
          startDate: '2026-01-10',
          endDate: '2026-05-15',
        }),
      ).rejects.toThrow(ConflictException);
    });

    it('should throw ConflictException when same calendar month', async () => {
      const now = new Date();
      const sameMonth = new Date(now.getFullYear(), now.getMonth(), 1);
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: sameMonth.toISOString(),
      });

      await expect(
        service.rollover({
          chapterId: 'ch-1',
          label: 'Duplicate',
          startDate: '2026-01-01',
          endDate: '2026-01-31',
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('listSemesters', () => {
    it('should return archived semesters ordered by end date', async () => {
      mockArchiveRepo.findByChapter.mockResolvedValue([
        baseArchive,
        {
          ...baseArchive,
          id: 'arch-2',
          label: 'Spring 2025',
          start_date: '2025-01-10',
          end_date: '2025-05-15',
        },
      ]);

      const result = await service.listSemesters('ch-1');

      expect(result).toHaveLength(2);
      expect(mockArchiveRepo.findByChapter).toHaveBeenCalledWith('ch-1');
    });

    it('should return empty array when no archives exist', async () => {
      mockArchiveRepo.findByChapter.mockResolvedValue([]);

      const result = await service.listSemesters('ch-1');

      expect(result).toEqual([]);
    });

    it('should return single archive when only one exists', async () => {
      mockArchiveRepo.findByChapter.mockResolvedValue([baseArchive]);

      const result = await service.listSemesters('ch-1');

      expect(result).toHaveLength(1);
      expect(result[0].label).toBe('Fall 2025');
    });
  });

  describe('rollover edge cases', () => {
    it('should succeed when last rollover was 2 months ago', async () => {
      const twoMonthsAgo = new Date();
      twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
      mockArchiveRepo.findLatestByChapter.mockResolvedValue({
        ...baseArchive,
        created_at: twoMonthsAgo.toISOString(),
      });
      mockArchiveRepo.create.mockResolvedValue({
        ...baseArchive,
        id: 'arch-2',
        label: 'Spring 2026',
      });

      const result = await service.rollover({
        chapterId: 'ch-1',
        label: 'Spring 2026',
        startDate: '2026-01-10',
        endDate: '2026-05-15',
      });

      expect(result.label).toBe('Spring 2026');
      expect(mockArchiveRepo.create).toHaveBeenCalledTimes(1);
    });
  });
});
