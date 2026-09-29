import { Test } from '@nestjs/testing';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import {
  ArchiveMediaCopyError,
  type ArchiveMediaCopyItem,
} from '#domain/adapters/archive-media-copier.interface';
import {
  ARCHIVE_MEDIA_COPY_BUDGET_MS,
  ARCHIVE_MEDIA_COPY_FUNCTION,
  ARCHIVE_MEDIA_COPY_RETRY_DELAYS_MS,
  ARCHIVE_MEDIA_COPY_TIMEOUT_MS,
  SupabaseArchiveMediaCopier,
} from './supabase-archive-media-copier.service';
import { LEASE_MS } from '../../modules/discord-import-worker/discord-import-worker.service';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';

const item = (path: string): ArchiveMediaCopyItem => ({
  url: `https://cdn.discordapp.com/a/${path}`,
  bucket: 'chat-archive',
  path,
  contentType: 'image/png',
  declaredSize: 10,
});

const ok = (data: unknown) => ({ data, error: null });
const failed = (error: unknown) => ({ data: null, error });
const httpError = (status: number, body = '') =>
  new FunctionsHttpError(new Response(body, { status }));

describe('SupabaseArchiveMediaCopier', () => {
  let copier: SupabaseArchiveMediaCopier;
  let invoke: jest.Mock;
  let wait: jest.SpyInstance;
  let now: jest.SpyInstance;

  beforeEach(async () => {
    invoke = jest.fn();
    const moduleRef = await Test.createTestingModule({
      providers: [
        SupabaseArchiveMediaCopier,
        { provide: SUPABASE_CLIENT, useValue: { functions: { invoke } } },
      ],
    }).compile();
    copier = moduleRef.get(SupabaseArchiveMediaCopier);
    // The real wait is seconds long; the retry ORDER is what is under test.
    wait = jest.spyOn(copier, 'wait').mockResolvedValue(undefined);
    now = jest.spyOn(copier, 'now').mockReturnValue(0);
  });

  it('calls the function with the batch, inside the platform timeout', async () => {
    const items = [item('a'), item('b')];
    invoke.mockResolvedValue(
      ok({
        results: [
          { path: 'a', status: 'stored', bytes: 11 },
          { path: 'b', status: 'gone', reason: 'CDN answered 404.' },
        ],
      }),
    );

    const results = await copier.copy(items);

    expect(invoke).toHaveBeenCalledWith(ARCHIVE_MEDIA_COPY_FUNCTION, {
      body: { items },
      timeout: ARCHIVE_MEDIA_COPY_TIMEOUT_MS,
    });
    // Under the platform's 150 s idle timeout, over the function's 120 s stop.
    expect(ARCHIVE_MEDIA_COPY_TIMEOUT_MS).toBeGreaterThan(120_000);
    expect(ARCHIVE_MEDIA_COPY_TIMEOUT_MS).toBeLessThan(150_000);
    expect(results).toEqual([
      { path: 'a', status: 'stored', bytes: 11 },
      { path: 'b', status: 'gone', reason: 'CDN answered 404.' },
    ]);
  });

  it('makes no call for an empty batch', async () => {
    await expect(copier.copy([])).resolves.toEqual([]);
    expect(invoke).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing result', { results: [] }],
    [
      'a result for a path it was not asked about',
      {
        results: [{ path: 'other', status: 'stored' }],
      },
    ],
    [
      'a status it does not know',
      {
        results: [{ path: 'a', status: 'maybe' }],
      },
    ],
    ['no results at all', 'Function returned text'],
  ])('refuses an answer with %s', async (_label, data) => {
    invoke.mockResolvedValue(ok(data));
    await expect(copier.copy([item('a')])).rejects.toThrow(
      ArchiveMediaCopyError,
    );
  });

  it.each([400, 401, 404])(
    'fails at once on %i, which no retry fixes',
    async (status) => {
      invoke.mockResolvedValue(
        failed(httpError(status, '{"error":"Not authorized."}')),
      );

      const error = await copier.copy([item('a')]).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(ArchiveMediaCopyError);
      expect((error as Error).message).toContain(`answered ${status}`);
      expect((error as Error).message).toContain('Not authorized.');
      expect(invoke).toHaveBeenCalledTimes(1);
      expect(wait).not.toHaveBeenCalled();
    },
  );

  it('retries a 5xx, then succeeds', async () => {
    invoke
      .mockResolvedValueOnce(failed(httpError(503)))
      .mockResolvedValueOnce(failed(new FunctionsRelayError(new Response())))
      .mockResolvedValueOnce(
        ok({ results: [{ path: 'a', status: 'stored' }] }),
      );

    await expect(copier.copy([item('a')])).resolves.toEqual([
      { path: 'a', status: 'stored' },
    ]);
    expect(wait.mock.calls.map(([ms]) => ms)).toEqual([
      ...ARCHIVE_MEDIA_COPY_RETRY_DELAYS_MS,
    ]);
  });

  it('gives up after its retries and says the service could not be reached', async () => {
    invoke.mockResolvedValue(
      failed(new FunctionsFetchError(new TypeError('fetch failed'))),
    );

    await expect(copier.copy([item('a')])).rejects.toThrow(
      /could not be reached.*start it again to resume/,
    );
    expect(invoke).toHaveBeenCalledTimes(
      ARCHIVE_MEDIA_COPY_RETRY_DELAYS_MS.length + 1,
    );
  });

  it.each([
    [502, "Storage refused the function's service credential (401)."],
    [500, 'The function is missing its Supabase config.'],
  ])(
    'fails at once on a %i the function marks not retryable',
    async (status, message) => {
      invoke.mockResolvedValue(
        failed(
          httpError(
            status,
            JSON.stringify({ error: message, retryable: false }),
          ),
        ),
      );

      await expect(copier.copy([item('a')])).rejects.toThrow(message);
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );

  it('does not start a retry that could outlast its time budget', async () => {
    // The first attempt timed out at 140 s: another 140 s would pass the budget.
    invoke.mockResolvedValue(
      failed(
        new FunctionsFetchError(new DOMException('aborted', 'AbortError')),
      ),
    );
    now.mockReturnValueOnce(0).mockReturnValue(ARCHIVE_MEDIA_COPY_TIMEOUT_MS);

    await expect(copier.copy([item('a')])).rejects.toThrow(
      /did not answer within 140 s/,
    );
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('keeps one call inside the import lease', () => {
    // The worker renews the lease before each call; one call must not outlast it.
    expect(ARCHIVE_MEDIA_COPY_BUDGET_MS).toBeLessThan(LEASE_MS);
  });

  it('names a timeout as a timeout', async () => {
    invoke.mockResolvedValue(
      failed(
        new FunctionsFetchError(new DOMException('aborted', 'AbortError')),
      ),
    );

    await expect(copier.copy([item('a')])).rejects.toThrow(
      /did not answer within 140 s/,
    );
  });
});
