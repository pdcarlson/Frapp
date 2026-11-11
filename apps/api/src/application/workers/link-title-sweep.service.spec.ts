import {
  LINK_TITLE_BATCH,
  LinkTitleSweepService,
} from './link-title-sweep.service';
import type { LinkTitleCandidate } from '#domain/repositories/chat-message-link.repository.interface';
import type { LinkTitleResult } from '#domain/adapters/link-title.interface';

const NOW = Date.parse('2026-11-11T12:00:00.000Z');

const candidate = (
  id: string,
  url = `https://forms.gle/${id}`,
  chapter_id = 'chapter-a',
  title_attempts = 0,
): LinkTitleCandidate => ({ id, url, chapter_id, title_attempts });

const titled = (title: string): LinkTitleResult => ({
  outcome: 'title',
  title,
});

function build() {
  const linkRepo = {
    findTitlePending: jest.fn().mockResolvedValue([]),
    claimForTitle: jest.fn().mockResolvedValue(true),
    finishTitle: jest.fn().mockResolvedValue(undefined),
  };
  const fetcher = {
    fetchTitle: jest
      .fn<Promise<LinkTitleResult>, [string]>()
      .mockResolvedValue({ outcome: 'none' }),
  };
  const sweep = new LinkTitleSweepService(linkRepo as never, fetcher);
  return { sweep, linkRepo, fetcher };
}

describe('LinkTitleSweepService (#4187)', () => {
  it('reads links waiting for a name inside Activity’s 30-day window, retrying a failed one after an hour', async () => {
    const { sweep, linkRepo } = build();

    await expect(sweep.sweep(NOW)).resolves.toEqual({
      read: 0,
      titled: 0,
      failed: 0,
    });

    expect(linkRepo.findTitlePending).toHaveBeenCalledWith({
      since: '2026-10-12T12:00:00.000Z',
      retryBefore: '2026-11-11T11:00:00.000Z',
      limit: LINK_TITLE_BATCH,
    });
    expect(linkRepo.claimForTitle).not.toHaveBeenCalled();
  });

  it('claims each link just before its read, and reads only what it won', async () => {
    const { sweep, linkRepo, fetcher } = build();
    linkRepo.findTitlePending.mockResolvedValue([
      candidate('mine'),
      candidate('theirs'),
    ]);
    // Another replica claimed `theirs` between the read and the claim.
    linkRepo.claimForTitle.mockImplementation(
      async (link: LinkTitleCandidate) => link.id === 'mine',
    );
    fetcher.fetchTitle.mockResolvedValue(titled('Formal RSVP'));

    const result = await sweep.sweep(NOW);

    expect(fetcher.fetchTitle).toHaveBeenCalledTimes(1);
    expect(fetcher.fetchTitle).toHaveBeenCalledWith('https://forms.gle/mine');
    expect(linkRepo.claimForTitle.mock.invocationCallOrder[0]).toBeLessThan(
      fetcher.fetchTitle.mock.invocationCallOrder[0],
    );
    // `theirs` is claimed only after `mine` was read: one link in flight.
    expect(linkRepo.claimForTitle.mock.invocationCallOrder[1]).toBeGreaterThan(
      fetcher.fetchTitle.mock.invocationCallOrder[0],
    );
    expect(linkRepo.finishTitle).toHaveBeenCalledWith(
      'chapter-a',
      ['mine'],
      'Formal RSVP',
    );
    expect(result).toEqual({ read: 1, titled: 1, failed: 0 });
  });

  it('reads a URL posted twice once, and writes each chapter’s links in that chapter', async () => {
    const { sweep, linkRepo, fetcher } = build();
    const url = 'https://forms.gle/shared';
    linkRepo.findTitlePending.mockResolvedValue([
      candidate('a1', url, 'chapter-a'),
      candidate('a2', url, 'chapter-a'),
      candidate('b1', url, 'chapter-b'),
    ]);
    fetcher.fetchTitle.mockResolvedValue(titled('Philanthropy 5K'));

    await expect(sweep.sweep(NOW)).resolves.toEqual({
      read: 3,
      titled: 3,
      failed: 0,
    });

    expect(fetcher.fetchTitle).toHaveBeenCalledTimes(1);
    expect(linkRepo.finishTitle).toHaveBeenCalledWith(
      'chapter-a',
      ['a1', 'a2'],
      'Philanthropy 5K',
    );
    expect(linkRepo.finishTitle).toHaveBeenCalledWith(
      'chapter-b',
      ['b1'],
      'Philanthropy 5K',
    );
  });

  it('ends a page with no name, which keeps the row’s kind and is never read again', async () => {
    const { sweep, linkRepo } = build();
    linkRepo.findTitlePending.mockResolvedValue([candidate('private')]);

    await expect(sweep.sweep(NOW)).resolves.toEqual({
      read: 1,
      titled: 0,
      failed: 0,
    });
    expect(linkRepo.finishTitle).toHaveBeenCalledWith(
      'chapter-a',
      ['private'],
      null,
    );
  });

  it('leaves a failed read to be tried again, and reports the tick', async () => {
    const { sweep, linkRepo, fetcher } = build();
    linkRepo.findTitlePending.mockResolvedValue([
      candidate('slow'),
      candidate('ok'),
    ]);
    fetcher.fetchTitle.mockImplementation(async (url: string) =>
      url.endsWith('slow')
        ? { outcome: 'failed', reason: 'timeout' }
        : titled('Rush BBQ'),
    );
    const warn = jest
      .spyOn(
        (sweep as unknown as { logger: { warn: jest.Mock } }).logger,
        'warn',
      )
      .mockImplementation(() => undefined);

    await expect(sweep.sweep(NOW)).resolves.toEqual({
      read: 2,
      titled: 1,
      failed: 1,
    });
    // No definite answer is written for it, so its claim and spent try stand.
    expect(linkRepo.finishTitle).toHaveBeenCalledTimes(1);
    expect(linkRepo.finishTitle).toHaveBeenCalledWith(
      'chapter-a',
      ['ok'],
      'Rush BBQ',
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('failed for 1 of 2'),
    );
  });

  it('carries on past a failed write', async () => {
    const { sweep, linkRepo, fetcher } = build();
    linkRepo.findTitlePending.mockResolvedValue([
      candidate('one'),
      candidate('two'),
    ]);
    fetcher.fetchTitle.mockResolvedValue(titled('A name'));
    linkRepo.finishTitle
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);

    await expect(sweep.sweep(NOW)).resolves.toEqual({
      read: 2,
      titled: 1,
      failed: 0,
    });
    expect(linkRepo.finishTitle).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the last one on this replica is still running', async () => {
    const { sweep, linkRepo } = build();
    let release: (rows: LinkTitleCandidate[]) => void = () => undefined;
    linkRepo.findTitlePending.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = sweep.handleLinkTitleSweep();
    await sweep.handleLinkTitleSweep();
    expect(linkRepo.findTitlePending).toHaveBeenCalledTimes(1);

    release([]);
    await first;
    await sweep.handleLinkTitleSweep();
    expect(linkRepo.findTitlePending).toHaveBeenCalledTimes(2);
  });
});
