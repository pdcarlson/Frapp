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
      listFolders: jest.fn(async () => []),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReportRetentionService,
        { provide: STORAGE_PROVIDER, useValue: mockStorage },
      ],
    }).compile();

    service = module.get(ReportRetentionService);
  });

  it('pins the retention window to the 24h that spec/behavior/reports.md promises users', () => {
    // The specs state this number as a hard guarantee. Changing the constant
    // without changing them is the drift this assertion exists to catch — the
    // boundary tests below are written against the constant, so they would
    // happily follow it anywhere.
    expect(REPORT_RETENTION_HOURS).toBe(24);
  });

  describe('sweepExpiredReports', () => {
    it('derives its work list from storage, not a chapter table', async () => {
      mockStorage.listFolders.mockResolvedValue(['c1', 'c2']);

      await service.sweepExpiredReports(NOW);

      expect(mockStorage.listFolders).toHaveBeenCalledWith(
        'reports',
        'chapters',
      );
      expect(mockStorage.listObjects).toHaveBeenCalledWith(
        'reports',
        'chapters/c1/reports',
      );
      expect(mockStorage.listObjects).toHaveBeenCalledWith(
        'reports',
        'chapters/c2/reports',
      );
    });

    it('reaps a prefix whose chapter row no longer exists', async () => {
      // Storage folders are virtual and outlive the DB row, which is the whole
      // reason the work list comes from storage: a chapter deleted by an
      // operator would otherwise strand its PII-bearing exports forever.
      mockStorage.listFolders.mockResolvedValue(['deleted-chapter']);
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/deleted-chapter/reports/roster-old.pdf', 48),
      ]);

      const result = await service.sweepExpiredReports(NOW);

      expect(result.deleted).toBe(1);
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/deleted-chapter/reports/roster-old.pdf',
      ]);
    });

    it('does no listing work when no chapter has ever exported', async () => {
      const result = await service.sweepExpiredReports(NOW);

      expect(result).toEqual({ deleted: 0, failed: 0 });
      expect(mockStorage.listObjects).not.toHaveBeenCalled();
    });

    it('deletes only objects past the retention window', async () => {
      mockStorage.listFolders.mockResolvedValue(['c1']);
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/roster-2026-08-06-a.pdf', 48),
        aged('chapters/c1/reports/points-2026-08-08-b.pdf', 2),
        aged('chapters/c1/reports/roster-2026-08-07-c.pdf', 25),
      ]);

      const result = await service.sweepExpiredReports(NOW);

      expect(result.deleted).toBe(2);
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c1/reports/roster-2026-08-06-a.pdf',
        'chapters/c1/reports/roster-2026-08-07-c.pdf',
      ]);
    });

    it('keeps an object exactly at the boundary and drops the one just past it', async () => {
      mockStorage.listFolders.mockResolvedValue(['c1']);
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/at-boundary.pdf', REPORT_RETENTION_HOURS),
        aged(
          'chapters/c1/reports/past-boundary.pdf',
          REPORT_RETENTION_HOURS + 0.001,
        ),
      ]);

      await service.sweepExpiredReports(NOW);

      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c1/reports/past-boundary.pdf',
      ]);
    });

    it('keeps an object whose stored-at timestamp is unknown, and warns', async () => {
      // Unknown age must not read as "infinitely old" — that would delete an
      // export the officer is still downloading. But an age filter that can
      // never fire would otherwise be indistinguishable from a healthy sweep
      // with nothing to do, so it has to be audible.
      const warn = jest
        .spyOn(service['logger'], 'warn')
        .mockImplementation(() => undefined);
      mockStorage.listFolders.mockResolvedValue(['c1']);
      mockStorage.listObjects.mockResolvedValue([
        { path: 'chapters/c1/reports/no-metadata.pdf', createdAt: null },
      ]);

      const result = await service.sweepExpiredReports(NOW);

      expect(result).toEqual({ deleted: 0, failed: 0 });
      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('no stored-at timestamp'),
      );
    });

    it('issues no delete for a chapter with nothing expired', async () => {
      mockStorage.listFolders.mockResolvedValue(['c1']);
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/fresh.pdf', 1),
      ]);

      await service.sweepExpiredReports(NOW);

      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
    });

    it('keeps sweeping after one chapter fails to list, and reports the failure', async () => {
      // Failure isolation matters more here than elsewhere: nothing records
      // sweep progress, so an unhandled throw would silently leave every
      // later chapter unreaped until someone noticed the bucket growing.
      mockStorage.listFolders.mockResolvedValue(['c1', 'c2']);
      mockStorage.listObjects
        .mockRejectedValueOnce(new Error('prefix listing 500'))
        .mockResolvedValueOnce([aged('chapters/c2/reports/old.pdf', 48)]);

      const result = await service.sweepExpiredReports(NOW);

      expect(result).toEqual({ deleted: 1, failed: 1 });
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c2/reports/old.pdf',
      ]);
    });

    it('isolates a failing delete too, not just a failing list', async () => {
      // The delete has to stay inside the per-chapter try. Batching every
      // chapter's expired paths into one trailing deleteFiles would move it
      // out, and then a single bad chunk aborts the whole sweep.
      mockStorage.listFolders.mockResolvedValue(['c1', 'c2']);
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/x/reports/old.pdf', 48),
      ]);
      mockStorage.deleteFiles
        .mockRejectedValueOnce(new Error('remove 500'))
        .mockResolvedValueOnce(undefined);

      const result = await service.sweepExpiredReports(NOW);

      expect(result).toEqual({ deleted: 1, failed: 1 });
    });
  });

  describe('purgeChapterReports', () => {
    it('deletes the whole prefix regardless of age', async () => {
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/old.pdf', 48),
        aged('chapters/c1/reports/rendered-a-second-ago.pdf', 0),
      ]);

      const deleted = await service.purgeChapterReports('c1');

      expect(deleted).toBe(2);
      expect(mockStorage.deleteFiles).toHaveBeenCalledWith('reports', [
        'chapters/c1/reports/old.pdf',
        'chapters/c1/reports/rendered-a-second-ago.pdf',
      ]);
    });

    it('deletes an object even when its stored-at timestamp is unknown', async () => {
      // The age-blind path must not inherit the sweep's keep-on-unknown rule,
      // or erasure would skip exactly the objects the sweep also cannot reap.
      mockStorage.listObjects.mockResolvedValue([
        { path: 'chapters/c1/reports/no-metadata.pdf', createdAt: null },
      ]);

      expect(await service.purgeChapterReports('c1')).toBe(1);
    });

    it('is a no-op for an empty prefix', async () => {
      const deleted = await service.purgeChapterReports('c1');

      expect(deleted).toBe(0);
      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
    });
  });

  describe('purgeUserReports', () => {
    it('purges each chapter once, even when the list repeats one', async () => {
      mockStorage.listObjects.mockResolvedValue([
        aged('chapters/c1/reports/x.pdf', 1),
      ]);

      await service.purgeUserReports(['c1', 'c2', 'c1']);

      expect(mockStorage.listObjects).toHaveBeenCalledTimes(2);
    });

    it('propagates a failure so the caller can decide', async () => {
      // The scheduled sweep swallows per-chapter errors; this path does not,
      // so account deletion can log it against its own retry story.
      mockStorage.listObjects.mockRejectedValue(new Error('storage down'));

      await expect(service.purgeUserReports(['c1'])).rejects.toThrow(
        'storage down',
      );
    });

    it('does nothing for a member with no chapters', async () => {
      await service.purgeUserReports([]);

      expect(mockStorage.listObjects).not.toHaveBeenCalled();
      expect(mockStorage.deleteFiles).not.toHaveBeenCalled();
    });
  });
});
