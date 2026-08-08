import { Test, TestingModule } from '@nestjs/testing';
import {
  REPORT_RETENTION_HOURS,
  ReportRetentionService,
} from './report-retention.service';
import {
  STORAGE_PROVIDER,
  type IStorageProvider,
  type StorageObject,
} from '../../domain/adapters/storage.interface';

const NOW = new Date('2026-08-08T12:00:00Z');

/** An object stored `hours` before NOW. */
const aged = (path: string, hours: number): StorageObject => ({
  path,
  createdAt: new Date(NOW.getTime() - hours * 60 * 60 * 1000),
});

describe('ReportRetentionService', () => {
  let service: ReportRetentionService;
  let mockStorage: jest.Mocked<IStorageProvider>;

  beforeEach(async () => {
    mockStorage = {
      getSignedUploadUrl: jest.fn(),
      getSignedDownloadUrl: jest.fn(),
      uploadFile: jest.fn(),
      downloadFile: jest.fn(),
      deleteFile: jest.fn(),
      deleteFiles: jest.fn(async () => {}),
      listFiles: jest.fn(async () => []),
      listObjects: jest.fn(async () => []),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportRetentionService,
        { provide: STORAGE_PROVIDER, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(ReportRetentionService);
  });

  describe('sweepExpiredReports', () => {
    it('deletes only objects past the retention window', async () => {
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/roster-2026-08-06-a.pdf', 48),
        aged('chapters/c1/reports/points-2026-08-08-b.pdf', 2),
        aged('chapters/c1/reports/roster-2026-08-07-c.pdf', 25),
      ]);

      const result = await service.sweepExpiredReports(['c1'], NOW);

      expect(result).toEqual({ deleted: 2 });
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c1/reports/roster-2026-08-06-a.pdf',
        'chapters/c1/reports/roster-2026-08-07-c.pdf',
      ]);
    });

    it('keeps an object exactly at the boundary and drops the one just past it', async () => {
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/at-boundary.pdf', REPORT_RETENTION_HOURS),
        aged(
          'chapters/c1/reports/past-boundary.pdf',
          REPORT_RETENTION_HOURS + 0.001,
        ),
      ]);

      await service.sweepExpiredReports(['c1'], NOW);

      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c1/reports/past-boundary.pdf',
      ]);
    });

    it('keeps an object whose stored-at timestamp is unknown', async () => {
      // Unknown age must not read as "infinitely old" — that would delete an
      // export the officer is still downloading. The next tick re-checks it.
      mockStorage.listObjects.mockResolvedValue([
        { path: 'chapters/c1/reports/no-metadata.pdf', createdAt: null },
      ]);

      const result = await service.sweepExpiredReports(['c1'], NOW);

      expect(result).toEqual({ deleted: 0 });
      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
    });

    it('walks each chapter prefix explicitly', async () => {
      await service.sweepExpiredReports(['c1', 'c2'], NOW);

      expect(mockStorage.listObjects).toHaveBeenCalledWith(
        'reports',
        'chapters/c1/reports',
      );
      expect(mockStorage.listObjects).toHaveBeenCalledWith(
        'reports',
        'chapters/c2/reports',
      );
    });

    it('issues no delete for a chapter with nothing expired', async () => {
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/fresh.pdf', 1),
      ]);

      await service.sweepExpiredReports(['c1'], NOW);

      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
    });

    it('keeps sweeping after one chapter fails', async () => {
      // Failure isolation matters more here than elsewhere: nothing records
      // sweep progress, so an unhandled throw would silently leave every
      // later chapter unreaped until someone noticed the bucket growing.
      mockStorage.listObjects
        .mockRejectedValueOnce(new Error('prefix listing 500'))
        .mockResolvedValueOnce([aged('chapters/c2/reports/old.pdf', 48)]);

      const result = await service.sweepExpiredReports(['c1', 'c2'], NOW);

      expect(result).toEqual({ deleted: 1 });
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c2/reports/old.pdf',
      ]);
    });
  });

  describe('purgeChapterReports', () => {
    it('deletes the whole prefix regardless of age', async () => {
      mockStorage.listFiles.mockResolvedValue([
        'chapters/c1/reports/old.pdf',
        'chapters/c1/reports/rendered-a-second-ago.pdf',
      ]);

      const deleted = await service.purgeChapterReports('c1');

      expect(deleted).toBe(2);
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c1/reports/old.pdf',
        'chapters/c1/reports/rendered-a-second-ago.pdf',
      ]);
    });

    it('is a no-op for an empty prefix', async () => {
      const deleted = await service.purgeChapterReports('c1');

      expect(deleted).toBe(0);
      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
    });
  });

  describe('purgeUserReports', () => {
    it('purges each chapter once, even when the list repeats one', async () => {
      mockStorage.listFiles.mockResolvedValue(['chapters/c1/reports/x.pdf']);

      await service.purgeUserReports(['c1', 'c2', 'c1']);

      expect(mockStorage.listFiles).toHaveBeenCalledTimes(2);
    });

    it('propagates a failure so account deletion can abort', async () => {
      // The scheduled sweep swallows per-chapter errors; this path must not —
      // account deletion promises PII is gone before it reports success.
      mockStorage.listFiles.mockRejectedValue(new Error('storage down'));

      await expect(service.purgeUserReports(['c1'])).rejects.toThrow(
        'storage down',
      );
    });

    it('does nothing for a member with no chapters', async () => {
      await service.purgeUserReports([]);

      expect(mockStorage.listFiles).not.toHaveBeenCalled();
      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
    });
  });
});
