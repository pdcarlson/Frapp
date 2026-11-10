import { BadRequestException } from '@nestjs/common';
import { TestingModule } from '@nestjs/testing';
import { createUnguardedTestingModule } from '#test/helpers/guard-stubs.factory';
import type { Response } from 'express';
import { SearchController } from './search.controller';
import {
  SearchService,
  type SearchResult,
} from '../../application/services/search.service';
import type { Event } from '#domain/entities/event.entity';

describe('SearchController', () => {
  let controller: SearchController;
  let searchService: jest.Mocked<Pick<SearchService, 'searchWithinBudget'>>;

  const emptyResult: SearchResult = {
    backwork: [],
    events: [],
    members: [],
    messages: [],
  };

  const makeRes = () =>
    ({ setHeader: jest.fn() }) as unknown as Response & {
      setHeader: jest.Mock;
    };

  beforeEach(async () => {
    searchService = {
      searchWithinBudget: jest.fn(),
    };

    const module: TestingModule = await createUnguardedTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: searchService }],
    }).compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('returns the service results and does not set the header on a normal search', async () => {
    const results = { ...emptyResult, events: [{ id: 'ev-1' } as Event] };
    searchService.searchWithinBudget.mockResolvedValue({
      results,
      timedOut: false,
      timedOutSources: [],
    });
    const res = makeRes();

    const body = await controller.search('ch-1', 'user-1', 'hello', res);

    expect(body).toBe(results);
    expect(res.setHeader).not.toHaveBeenCalled();
  });

  it('sets x-search-timeout: 1 when the search times out', async () => {
    searchService.searchWithinBudget.mockResolvedValue({
      results: emptyResult,
      timedOut: true,
      timedOutSources: ['messages'],
    });
    const res = makeRes();

    const body = await controller.search('ch-1', 'user-1', 'hello', res);

    expect(body).toBe(emptyResult);
    expect(res.setHeader).toHaveBeenCalledWith('x-search-timeout', '1');
    // Which section is short, so a client can say "still searching messages"
    // rather than rendering an empty list as "no matches".
    expect(res.setHeader).toHaveBeenCalledWith(
      'x-search-timeout-sources',
      'messages',
    );
  });

  it('coalesces a missing query to an empty string', async () => {
    searchService.searchWithinBudget.mockResolvedValue({
      results: emptyResult,
      timedOut: false,
      timedOutSources: [],
    });
    const res = makeRes();

    await controller.search('ch-1', 'user-1', undefined as never, res);

    expect(searchService.searchWithinBudget).toHaveBeenCalledWith(
      'ch-1',
      'user-1',
      '',
      {},
    );
  });

  it('passes channelId through for the single-channel form of search', async () => {
    searchService.searchWithinBudget.mockResolvedValue({
      results: emptyResult,
      timedOut: false,
      timedOutSources: [],
    });
    const res = makeRes();

    await controller.search('ch-1', 'user-1', 'budget', res, 'chan-9');

    expect(searchService.searchWithinBudget).toHaveBeenCalledWith(
      'ch-1',
      'user-1',
      'budget',
      { channelId: 'chan-9' },
    );
  });

  it.each([
    ['an omitted channelId', undefined],
    ['an empty channelId', ''],
    ['a whitespace-only channelId', '   '],
    // `qs` yields an array for `?channelId=a&channelId=b` and an object for
    // `?channelId[k]=v`, and Nest's ValidationPipe does not coerce a String
    // metatype — so a bare `.trim()` here turned a malformed read into a 500.
    ['a repeated channelId', ['a', 'b']],
    ['a bracketed channelId', { k: 'v' }],
    ['a non-string channelId', 42],
  ])('treats %s as chapter-wide, not as a channel named ""', async (_, raw) => {
    searchService.searchWithinBudget.mockResolvedValue({
      results: emptyResult,
      timedOut: false,
      timedOutSources: [],
    });
    const res = makeRes();

    await controller.search('ch-1', 'user-1', 'budget', res, raw);

    // `?channelId=` with no value must not narrow to a channel that cannot
    // exist — that would intersect to nothing and render "no matches in this
    // channel" for a search the member meant to run across all of them.
    expect(searchService.searchWithinBudget).toHaveBeenCalledWith(
      'ch-1',
      'user-1',
      'budget',
      {},
    );
  });

  describe('message filters (#3958)', () => {
    const run = async (
      ...filters: [unknown?, unknown?, unknown?, unknown?, unknown?]
    ) => {
      searchService.searchWithinBudget.mockResolvedValue({
        results: emptyResult,
        timedOut: false,
        timedOutSources: [],
      });
      await controller.search('ch-1', 'user-1', '', makeRes(), ...filters);
      return searchService.searchWithinBudget.mock.calls[0][3] as unknown;
    };

    it('passes sender, dates and has through, dates as instants', async () => {
      expect(
        await run(
          'chan-9',
          ' user-7 ',
          '2026-11-01',
          '2026-11-08T05:00:00.000Z',
          'file, image,file',
        ),
      ).toEqual({
        channelId: 'chan-9',
        fromUserId: 'user-7',
        after: '2026-11-01T00:00:00.000Z',
        before: '2026-11-08T05:00:00.000Z',
        has: ['file', 'image'],
      });
    });

    it('reads a repeated has as a list', async () => {
      expect(
        await run(undefined, undefined, undefined, undefined, ['poll', 'link']),
      ).toEqual({ has: ['poll', 'link'] });
    });

    it.each([
      ['an unknown has', [undefined, undefined, undefined, undefined, 'video']],
      ['a non-string has', [undefined, undefined, undefined, undefined, 42]],
      ['an unreadable after', [undefined, undefined, 'yesterday']],
      ['a bare number as before', [undefined, undefined, undefined, '7']],
      [
        'a repeated after',
        [undefined, undefined, ['2026-11-01', '2026-11-02']],
      ],
    ] as const)(
      'rejects %s with a 400 rather than dropping the filter',
      async (_, filters) => {
        await expect(
          run(...(filters as unknown as [unknown])),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(searchService.searchWithinBudget).not.toHaveBeenCalled();
      },
    );
  });
});
