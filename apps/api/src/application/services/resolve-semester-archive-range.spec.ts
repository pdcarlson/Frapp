import { NotFoundException } from '@nestjs/common';
import { resolveSemesterArchiveRangeOrThrow } from './resolve-semester-archive-range';
import type { ISemesterArchiveRepository } from '../../domain/repositories/semester-archive.repository.interface';

describe('resolveSemesterArchiveRangeOrThrow', () => {
  const makeRepo = (
    findById: ISemesterArchiveRepository['findById'],
  ): ISemesterArchiveRepository => ({
    findByChapter: jest.fn(),
    findLatestByChapter: jest.fn(),
    create: jest.fn(),
    createWithPromotion: jest.fn(),
    findById,
  });

  it('resolves the [since, until] range for an archive the repo returns', async () => {
    const repo = makeRepo(
      jest.fn().mockResolvedValue({
        id: 'sa-1',
        chapter_id: 'ch-1',
        label: 'Spring 2026',
        start_date: '2026-01-15',
        end_date: '2026-05-15',
        created_at: '2026-05-16T00:00:00.000Z',
      }),
    );

    const range = await resolveSemesterArchiveRangeOrThrow(
      repo,
      'sa-1',
      'ch-1',
    );

    expect(repo.findById).toHaveBeenCalledWith('sa-1', 'ch-1');
    expect(range.since.toISOString()).toBe('2026-01-14T23:59:59.999Z');
    expect(range.until.toISOString()).toBe('2026-05-15T23:59:59.999Z');
  });

  it('throws NotFoundException when the repo returns null (unknown id or another chapter)', async () => {
    const repo = makeRepo(jest.fn().mockResolvedValue(null));

    await expect(
      resolveSemesterArchiveRangeOrThrow(repo, 'not-a-real-id', 'ch-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('throws NotFoundException when the archive exists but its dates are unparseable', async () => {
    const repo = makeRepo(
      jest.fn().mockResolvedValue({
        id: 'sa-1',
        chapter_id: 'ch-1',
        label: 'Corrupt',
        start_date: 'not-a-date',
        end_date: '2026-05-15',
        created_at: '2026-05-16T00:00:00.000Z',
      }),
    );

    await expect(
      resolveSemesterArchiveRangeOrThrow(repo, 'sa-1', 'ch-1'),
    ).rejects.toThrow(NotFoundException);
  });
});
