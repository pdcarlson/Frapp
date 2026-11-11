import { LINK_TITLE_BATCH, LinkTitleSweepService } from './link-title-sweep.service';
import type { LinkTitleCandidate } from '#domain/repositories/chat-message-link.repository.interface';

const NOW = Date.parse('2026-11-11T12:00:00.000Z');

const candidate = (
  id: string,
  url = `https://forms.gle/${id}`,
  chapter_id = 'chapter-a',
): LinkTitleCandidate => ({ id, url, chapter_id });

function build() {
  const linkRepo = {
    findTitleUnchecked: jest.fn().mockResolvedValue([]),
    claimForTitle: jest.fn(async (ids: string[]) =>
      ids.map((id) => candidate(id)),
    ),
    setTitle: jest.fn().mockResolvedValue(undefined),
  };
  const fetcher = { fetchTitle: jest.fn().mockResolvedValue(null) };
  const sweep = new LinkTitleSweepService(linkRepo as never, fetcher);
  return { sweep, linkRepo, fetcher };
}

describe('LinkTitleSweepService (#4187)', () => {
  it('reads unchecked links inside Activity’s 30-day window, a batch at a time', async () => {
    const { sweep, linkRepo } = build();

    await expect(sweep.sweep(NOW)).resolves.toEqual({ claimed: 0, titled: 0 });

    expect(linkRepo.findTitleUnchecked).toHaveBeenCalledWith({
      since: '2026-10-12T12:00:00.000Z',
      limit: LINK_TITLE_BATCH,
    });
    expect(linkRepo.claimForTitle).not.toHaveBeenCalled();
  });

  it('claims before it fetches, and fetches only what it won', async () => {
    const { sweep, linkRepo, fetcher } = build();
    linkRepo.findTitleUnchecked.mockResolvedValue([
      candidate('mine'),
      candidate('theirs'),
    ]);
    // Another replica claimed `theirs` between the read and the claim.
    linkRepo.claimForTitle.mockResolvedValue([candidate('mine')]);
    fetcher.fetchTitle.mockResolvedValue('Formal RSVP');

    const result = await sweep.sweep(NOW);

    expect(linkRepo.claimForTitle).toHaveBeenCalledWith(['mine', 'theirs']);
    expect(fetcher.fetchTitle).toHaveBeenCalledTimes(1);
    expect(fetcher.fetchTitle).toHaveBeenCalledWith('https://forms.gle/mine');
    expect(
      linkRepo.claimForTitle.mock.invocationCallOrder[0],
    ).toBeLessThan(fetcher.fetchTitle.mock.invocationCallOrder[0]);
    expect(linkRepo.setTitle).toHaveBeenCalledWith(
      'chapter-a',
      ['mine'],
      'Formal RSVP',
    );
    expect(result).toEqual({ claimed: 1, titled: 1 });
  });

  it('reads a URL posted twice once, and writes each chapter’s links in that chapter', async () => {
    const { sweep, linkRepo, fetcher } = build();
    const url = 'https://forms.gle/shared';
    const claimed = [
      candidate('a1', url, 'chapter-a'),
      candidate('a2', url, 'chapter-a'),
      candidate('b1', url, 'chapter-b'),
    ];
    linkRepo.findTitleUnchecked.mockResolvedValue(claimed);
    linkRepo.claimForTitle.mockResolvedValue(claimed);
    fetcher.fetchTitle.mockResolvedValue('Philanthropy 5K');

    await expect(sweep.sweep(NOW)).resolves.toEqual({ claimed: 3, titled: 3 });

    expect(fetcher.fetchTitle).toHaveBeenCalledTimes(1);
    expect(linkRepo.setTitle).toHaveBeenCalledWith(
      'chapter-a',
      ['a1', 'a2'],
      'Philanthropy 5K',
    );
    expect(linkRepo.setTitle).toHaveBeenCalledWith(
      'chapter-b',
      ['b1'],
      'Philanthropy 5K',
    );
  });

  it('writes nothing for a page with no title, which keeps the row’s kind', async () => {
    const { sweep, linkRepo } = build();
    linkRepo.findTitleUnchecked.mockResolvedValue([candidate('private')]);

    await expect(sweep.sweep(NOW)).resolves.toEqual({ claimed: 1, titled: 0 });
    expect(linkRepo.setTitle).not.toHaveBeenCalled();
  });

  it('carries on past a failed write', async () => {
    const { sweep, linkRepo, fetcher } = build();
    linkRepo.findTitleUnchecked.mockResolvedValue([
      candidate('one'),
      candidate('two'),
    ]);
    fetcher.fetchTitle.mockResolvedValue('A name');
    linkRepo.setTitle
      .mockRejectedValueOnce(new Error('write failed'))
      .mockResolvedValueOnce(undefined);

    await expect(sweep.sweep(NOW)).resolves.toEqual({ claimed: 2, titled: 1 });
    expect(linkRepo.setTitle).toHaveBeenCalledTimes(2);
  });

  it('skips a tick while the last one on this replica is still running', async () => {
    const { sweep, linkRepo } = build();
    let release: (rows: LinkTitleCandidate[]) => void = () => undefined;
    linkRepo.findTitleUnchecked.mockReturnValueOnce(
      new Promise((resolve) => {
        release = resolve;
      }),
    );

    const first = sweep.handleLinkTitleSweep();
    await sweep.handleLinkTitleSweep();
    expect(linkRepo.findTitleUnchecked).toHaveBeenCalledTimes(1);

    release([]);
    await first;
    await sweep.handleLinkTitleSweep();
    expect(linkRepo.findTitleUnchecked).toHaveBeenCalledTimes(2);
  });
});
