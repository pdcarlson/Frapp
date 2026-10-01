import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  FunctionsFetchError,
  FunctionsHttpError,
  FunctionsRelayError,
} from '@supabase/supabase-js';
import {
  ArchiveMediaCopyError,
  type ArchiveMediaCopyItem,
  type ArchiveMediaCopyResult,
  type ArchiveMediaCopyStatus,
  type IArchiveMediaCopier,
} from '#domain/adapters/archive-media-copier.interface';
import { SUPABASE_CLIENT } from '../supabase/supabase.provider';
import type { FrappSupabaseClient } from '../supabase/database.types';
import { toReportableError } from '../observability/reportable-error';

/** The Edge Function's name: `supabase/functions/discord-attachment-copy/`. */
export const ARCHIVE_MEDIA_COPY_FUNCTION = 'discord-attachment-copy';

/**
 * How long one call may take before the API gives up on it.
 *
 * The function answers by its own hard deadline (`HARD_DEADLINE_MS` in
 * `supabase/functions/discord-attachment-copy/handler.ts`), and the platform
 * returns a 504 at 150 s if it has not answered. This sits between the two, so
 * the API only times out on a call the platform is about to fail anyway.
 */
export const ARCHIVE_MEDIA_COPY_TIMEOUT_MS = 140_000;

/**
 * Waits before each retry of a call that failed as a whole.
 *
 * Re-sending a batch is safe: the function upserts, and the manifest, not the
 * object's existence, decides what is done. So a retry costs time, never a
 * duplicate.
 */
export const ARCHIVE_MEDIA_COPY_RETRY_DELAYS_MS = [2_000, 5_000] as const;

/**
 * The longest one `copy()` may run, retries included. A retry that could not
 * finish inside it is not started.
 *
 * Sized against the import lease (`LEASE_MS`, 5 minutes). The worker renews the
 * lease before each call after a page's first, so one call is the longest the
 * lease goes unrenewed while copying; three attempts of up to 140 s would take
 * about seven minutes and let the lease lapse mid-call.
 */
export const ARCHIVE_MEDIA_COPY_BUDGET_MS = 200_000;

const STATUSES = new Set<ArchiveMediaCopyStatus>([
  'stored',
  'gone',
  'rejected',
  'failed',
  'deferred',
]);

/**
 * Copies Discord attachments through the `discord-attachment-copy` Edge
 * Function (#2848, ADR-26).
 *
 * Called with the service-role client every other adapter here uses, so the
 * function authenticates the API with the key it already holds; no new secret.
 */
@Injectable()
export class SupabaseArchiveMediaCopier implements IArchiveMediaCopier {
  private readonly logger = new Logger(SupabaseArchiveMediaCopier.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async copy(items: ArchiveMediaCopyItem[]): Promise<ArchiveMediaCopyResult[]> {
    if (items.length === 0) return [];

    const startedAt = this.now();
    for (let attempt = 0; ; attempt += 1) {
      const response = await this.supabase.functions.invoke<unknown>(
        ARCHIVE_MEDIA_COPY_FUNCTION,
        { body: { items }, timeout: ARCHIVE_MEDIA_COPY_TIMEOUT_MS },
      );
      // functions-js types a failure's `error` as `any`.
      const error: unknown = response.error;
      if (!error) return this.readResults(items, response.data);

      const failure = await describeFailure(error);
      const delay = ARCHIVE_MEDIA_COPY_RETRY_DELAYS_MS[attempt];
      const fits =
        delay !== undefined &&
        this.now() - startedAt + delay + ARCHIVE_MEDIA_COPY_TIMEOUT_MS <=
          ARCHIVE_MEDIA_COPY_BUDGET_MS;
      if (!failure.retryable || !fits) {
        throw new ArchiveMediaCopyError(
          `Could not copy attachments into the archive: the copy service ${failure.detail}. The import stopped rather than skip the files; start it again to resume where it left off.`,
        );
      }
      this.logger.warn(
        `Attachment copy call failed (${failure.detail}); retrying in ${delay} ms.`,
      );
      await this.wait(delay);
    }
  }

  /** Seams for tests, which replace the real clock and wait. */
  protected now(): number {
    return performance.now();
  }

  protected wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * The function's answer, checked item by item against what was sent.
   *
   * A result for a path that was not asked about, or one missing, means the
   * two sides disagree about the contract, and then no status in the answer
   * can be trusted to say which objects exist.
   */
  private readResults(
    items: ArchiveMediaCopyItem[],
    data: unknown,
  ): ArchiveMediaCopyResult[] {
    const results = (data as { results?: unknown } | null)?.results;
    const valid =
      Array.isArray(results) &&
      results.length === items.length &&
      results.every((entry, index) => {
        const result = entry as Partial<ArchiveMediaCopyResult> | null;
        return (
          result !== null &&
          typeof result === 'object' &&
          result.path === items[index].path &&
          typeof result.status === 'string' &&
          STATUSES.has(result.status)
        );
      });
    if (!valid) {
      throw new ArchiveMediaCopyError(
        'Could not copy attachments into the archive: the copy service answered in a shape this API does not understand. The import stopped rather than skip the files; start it again to resume where it left off.',
      );
    }
    return (results as ArchiveMediaCopyResult[]).map((result) => ({
      path: result.path,
      status: result.status,
      ...(typeof result.bytes === 'number' ? { bytes: result.bytes } : {}),
      ...(typeof result.reason === 'string' ? { reason: result.reason } : {}),
    }));
  }
}

/** Whether the function's error body says no retry can help. */
function declaresPermanent(text: string): boolean {
  try {
    const parsed = JSON.parse(text) as { retryable?: unknown } | null;
    return parsed?.retryable === false;
  } catch {
    return false;
  }
}

/** What went wrong with a whole call, and whether trying again can help. */
async function describeFailure(
  error: unknown,
): Promise<{ retryable: boolean; detail: string }> {
  if (error instanceof FunctionsHttpError) {
    const response = error.context as Response;
    const status = response.status;
    const text = await response.text().catch(() => '');
    const body = text.trim().slice(0, 200);
    return {
      // 5xx, including the platform's 504 and its 546 (a worker over its CPU
      // or memory limit), is the service having a bad moment. 4xx is the
      // request or the deploy being wrong (401: the key; 404: the function is
      // not deployed), which no retry fixes. So is a 5xx the function itself
      // marks `retryable: false`: Storage refusing its key, or its config
      // missing.
      retryable: status >= 500 && !declaresPermanent(text),
      detail: `answered ${status}${body ? ` (${body})` : ''}`,
    };
  }
  if (error instanceof FunctionsRelayError) {
    return { retryable: true, detail: 'could not be reached through Supabase' };
  }
  if (error instanceof FunctionsFetchError) {
    const cause = (error.context as { name?: string } | undefined)?.name;
    return {
      retryable: true,
      detail:
        cause === 'AbortError'
          ? `did not answer within ${ARCHIVE_MEDIA_COPY_TIMEOUT_MS / 1000} s`
          : 'could not be reached',
    };
  }
  return {
    retryable: false,
    detail: `failed: ${toReportableError(error).message}`,
  };
}
