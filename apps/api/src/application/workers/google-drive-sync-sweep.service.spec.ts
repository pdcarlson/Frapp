import type { IChapterDriveRepository } from '#domain/repositories/chapter-drive.repository.interface';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import type { GoogleDriveSyncService } from '../services/google-drive/google-drive-sync.service';
import {
  GOOGLE_DRIVE_SYNC_BATCH,
  GoogleDriveSyncSweepService,
} from './google-drive-sync-sweep.service';

const NOW = new Date('2026-11-16T15:00:00.000Z');
const conn = (id: string): ChapterDriveConnection =>
  ({ id, chapter_id: `ch-${id}`, status: 'active' }) as ChapterDriveConnection;

describe('GoogleDriveSyncSweepService', () => {
  let repo: jest.Mocked<Pick<IChapterDriveRepository, 'claim'>>;
  let sync: jest.Mocked<
    Pick<GoogleDriveSyncService, 'isAvailable' | 'process'>
  >;
  let sweep: GoogleDriveSyncSweepService;

  beforeEach(() => {
    repo = { claim: jest.fn().mockResolvedValue([]) };
    sync = {
      isAvailable: jest.fn().mockReturnValue(true),
      process: jest.fn().mockResolvedValue('synced'),
    };
    sweep = new GoogleDriveSyncSweepService(
      repo as unknown as IChapterDriveRepository,
      sync as unknown as GoogleDriveSyncService,
    );
  });

  it('does nothing while Google Drive is off on this server', async () => {
    sync.isAvailable.mockReturnValue(false);
    await sweep.sweep(NOW);
    expect(repo.claim).not.toHaveBeenCalled();
  });

  it('claims a batch with a lease and tallies each outcome, a broken one included', async () => {
    repo.claim.mockResolvedValue([conn('a'), conn('b'), conn('c')]);
    sync.process
      .mockResolvedValueOnce('synced')
      .mockResolvedValueOnce('more')
      .mockRejectedValueOnce(new Error('storage down'));

    const tally = await sweep.sweep(NOW);

    expect(repo.claim).toHaveBeenCalledWith(
      NOW,
      GOOGLE_DRIVE_SYNC_BATCH,
      expect.any(Number),
    );
    expect(repo.claim.mock.calls[0][2]).toBeGreaterThan(15 * 60);
    expect(sync.process).toHaveBeenCalledTimes(3);
    expect(tally).toMatchObject({ synced: 1, more: 1, error: 1 });
  });

  it('skips a tick while the last one is still running', async () => {
    let finish: () => void = () => {};
    repo.claim.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve([]);
      }),
    );
    const first = sweep.handleGoogleDriveSync();
    await sweep.handleGoogleDriveSync();
    finish();
    await first;
    expect(repo.claim).toHaveBeenCalledTimes(1);
  });
});
