import type { IChapterDriveRepository } from '#domain/repositories/chapter-drive.repository.interface';
import type { ChapterDriveConnection } from '#domain/entities/chapter-drive-connection.entity';
import type { IChapterDriveLinkRepository } from '#domain/repositories/chapter-drive-link.repository.interface';
import type { ChapterDriveLink } from '#domain/entities/chapter-drive-link.entity';
import type { GoogleDriveSyncService } from '../services/google-drive/google-drive-sync.service';
import type { GoogleDriveLinkService } from '../services/google-drive/google-drive-link.service';
import {
  GOOGLE_DRIVE_LINK_BATCH,
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
  let linkRepo: jest.Mocked<Pick<IChapterDriveLinkRepository, 'claim'>>;
  let links: jest.Mocked<
    Pick<GoogleDriveLinkService, 'isAvailable' | 'process'>
  >;
  let sweep: GoogleDriveSyncSweepService;

  beforeEach(() => {
    repo = { claim: jest.fn().mockResolvedValue([]) };
    sync = {
      isAvailable: jest.fn().mockReturnValue(true),
      process: jest.fn().mockResolvedValue('synced'),
    };
    linkRepo = { claim: jest.fn().mockResolvedValue([]) };
    links = {
      isAvailable: jest.fn().mockReturnValue(true),
      process: jest.fn().mockResolvedValue('unchanged'),
    };
    sweep = new GoogleDriveSyncSweepService(
      repo as unknown as IChapterDriveRepository,
      sync as unknown as GoogleDriveSyncService,
      linkRepo as unknown as IChapterDriveLinkRepository,
      links as unknown as GoogleDriveLinkService,
    );
  });

  it('checks a batch of linked files and tallies each, a broken one included (#5434)', async () => {
    const link = (id: string) => ({ id }) as ChapterDriveLink;
    linkRepo.claim.mockResolvedValue([link('a'), link('b'), link('c')]);
    links.process
      .mockResolvedValueOnce('updated')
      .mockResolvedValueOnce('no_access')
      .mockRejectedValueOnce(new Error('storage down'));

    const tally = await sweep.sweepLinks(NOW);

    expect(linkRepo.claim).toHaveBeenCalledWith(
      NOW,
      GOOGLE_DRIVE_LINK_BATCH,
      expect.any(Number),
    );
    expect(tally).toMatchObject({ updated: 1, no_access: 1, error: 1 });
  });

  it('checks no linked file while Google Drive is off', async () => {
    links.isAvailable.mockReturnValue(false);
    await sweep.sweepLinks(NOW);
    expect(linkRepo.claim).not.toHaveBeenCalled();
  });

  it('checks linked files on their own tick, so a long folder pass never holds them up', async () => {
    let finish: () => void = () => {};
    repo.claim.mockReturnValue(
      new Promise((resolve) => {
        finish = () => resolve([]);
      }),
    );
    const folders = sweep.handleGoogleDriveSync();
    await sweep.handleGoogleDriveLinkSync();
    expect(linkRepo.claim).toHaveBeenCalledTimes(1);
    expect(linkRepo.claim.mock.calls[0][2]).toBeGreaterThanOrEqual(30 * 60);
    finish();
    await folders;
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
