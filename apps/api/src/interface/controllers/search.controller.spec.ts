import { Test, TestingModule } from '@nestjs/testing';
import type { Response } from 'express';
import { SearchController } from './search.controller';
import { SearchService } from '../../application/services/search.service';
import { SupabaseAuthGuard } from '../guards/supabase-auth.guard';
import { ChapterGuard } from '../guards/chapter.guard';
import { PermissionsGuard } from '../guards/permissions.guard';

describe('SearchController', () => {
  let controller: SearchController;
  let searchService: jest.Mocked<Pick<SearchService, 'searchWithinBudget'>>;

  const emptyResult = {
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

    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
      providers: [{ provide: SearchService, useValue: searchService }],
    })
      .overrideGuard(SupabaseAuthGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(ChapterGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(PermissionsGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('returns the service results and does not set the header on a normal search', async () => {
    const results = { ...emptyResult, events: [{ id: 'ev-1' }] };
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
      undefined,
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
      'chan-9',
    );
  });

  it.each([
    ['an omitted channelId', undefined],
    ['an empty channelId', ''],
    ['a whitespace-only channelId', '   '],
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
      undefined,
    );
  });
});
