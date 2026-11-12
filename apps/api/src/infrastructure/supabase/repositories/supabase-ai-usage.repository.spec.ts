import { SupabaseAiUsageRepository } from './supabase-ai-usage.repository';
import {
  CHAPTER_A,
  CHAPTER_B,
  USER_A,
  createTenantHarness,
  type TenantHarness,
} from '#test/helpers/tenant-scope.harness';
import type { AiCallDescriptor } from '#domain/adapters/ai-call-context';
import type { AiUsageRecord } from '#domain/adapters/ai-usage-recorder.interface';

/**
 * Tenant scope for `ai_usage_events` (#714).
 *
 * Every read and write is a database function, whose SQL the PGlite gate runs
 * (`scripts/pglite/tiers/ai-usage-ledger.mjs`), so here the rule is the
 * argument: each chapter-scoped call passes the caller's chapter as
 * `p_chapter_id`, and the settle function matches a hold only inside it. The
 * exception, on purpose, is the sweep that expires dead holds: one sweep
 * serves every chapter, so it takes a time and no chapter, pinned below as
 * its own rule.
 */

const HOLD = '0d000000-0000-4000-8000-000000000714';
const NOW = new Date('2026-11-12T10:00:00.000Z');

const call = (chapterId: string): AiCallDescriptor => ({
  chapterId,
  actingUserId: USER_A,
  task: 'minutes.draft',
  family: 'meetings',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  promptVersion: 'minutes@v1',
});

const record = (chapterId: string): AiUsageRecord => ({
  ...call(chapterId),
  reservationId: HOLD,
  outcome: 'completed',
  errorKind: null,
  inputTokens: 1_000,
  outputTokens: 2_000,
  cachedInputTokens: 0,
  costMicroUsd: 22_000,
  latencyMs: 1_234.6,
});

const CAPS = {
  chapterMonthlyMicroUsd: 25_000_000,
  memberDailyMicroUsd: 2_000_000,
  platformMonthlyMicroUsd: 150_000_000,
};

describe('SupabaseAiUsageRepository — tenant scope', () => {
  let harness: TenantHarness;
  let repo: SupabaseAiUsageRepository;

  beforeEach(() => {
    harness = createTenantHarness({
      tables: {},
      rpc: {
        reserve_ai_spend: {
          data: [
            {
              reservation_id: HOLD,
              refused: null,
              platform_spent_before: '1000',
              platform_spent_after: '163000',
            },
          ],
        },
        settle_ai_spend: { data: 'settled' },
        expire_ai_spend_holds: { data: 3 },
        ai_chapter_usage: {
          data: [
            {
              task: 'minutes.draft',
              provider: 'anthropic',
              model: 'claude-sonnet-5-5',
              calls: '2',
              input_tokens: '2000',
              output_tokens: '4000',
              cached_input_tokens: '0',
              cost_micro_usd: '44000',
              estimated_cost_micro_usd: '0',
              unsettled_calls: '0',
            },
          ],
        },
      },
    });
    repo = new SupabaseAiUsageRepository(harness.client);
  });

  it('reserve holds inside the caller’s chapter, with every cap', async () => {
    const hold = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.reserve(call(CHAPTER_A), 162_000, CAPS, NOW),
    );
    expect(hold).toEqual({
      granted: true,
      reservationId: HOLD,
      platformSpentBeforeMicroUsd: 1_000,
      platformSpentAfterMicroUsd: 163_000,
    });
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'reserve_ai_spend',
        args: {
          p_chapter_id: CHAPTER_A,
          p_user_id: USER_A,
          p_run_id: null,
          p_task: 'minutes.draft',
          p_family: 'meetings',
          p_provider: 'anthropic',
          p_model: 'claude-sonnet-5-5',
          p_prompt_version: 'minutes@v1',
          p_reserved_cost_micro_usd: 162_000,
          p_chapter_cap_micro_usd: 25_000_000,
          p_member_cap_micro_usd: 2_000_000,
          p_platform_cap_micro_usd: 150_000_000,
          p_now: NOW.toISOString(),
        },
      },
    ]);
  });

  it('charges the chapter’s upkeep to no member, so it skips and never fills a member’s day (#4504)', async () => {
    const indexing: AiCallDescriptor = {
      ...call(CHAPTER_A),
      task: 'corpus.embed',
      family: 'corpus',
      provider: 'google',
      model: 'gemini-embedding-001',
      promptVersion: 'corpus.index@v1',
      runId: HOLD,
      chapterUpkeep: true,
    };
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.reserve(indexing, 10, CAPS, NOW),
    );
    await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.settle({ ...record(CHAPTER_A), ...indexing }, false, NOW),
    );
    expect(harness.rpcCalls.map((rpc) => rpc.args.p_user_id)).toEqual([
      null,
      null,
    ]);
  });

  it('reserve reads a refusal as the cap it names', async () => {
    harness = createTenantHarness({
      tables: {},
      rpc: {
        reserve_ai_spend: {
          data: [
            {
              reservation_id: null,
              refused: 'member_cap',
              platform_spent_before: 0,
              platform_spent_after: 0,
            },
          ],
        },
      },
    });
    repo = new SupabaseAiUsageRepository(harness.client);
    await expect(
      harness.expectTenantScoped(CHAPTER_B, () =>
        repo.reserve(call(CHAPTER_B), 1, CAPS, NOW),
      ),
    ).resolves.toEqual({ granted: false, cap: 'member_cap' });
  });

  it('settle matches the hold inside the caller’s chapter, rounding the latency', async () => {
    await expect(
      harness.expectTenantScoped(CHAPTER_A, () =>
        repo.settle(record(CHAPTER_A), false, NOW),
      ),
    ).resolves.toBe('settled');
    expect(harness.rpcCalls[0]).toEqual({
      fn: 'settle_ai_spend',
      args: expect.objectContaining({
        p_reservation_id: HOLD,
        p_chapter_id: CHAPTER_A,
        p_outcome: 'completed',
        p_error_kind: null,
        p_cost_micro_usd: 22_000,
        p_bill_reservation: false,
        p_latency_ms: 1_235,
      }),
    });
  });

  it('chapterUsage reads one chapter, as numbers', async () => {
    const lines = await harness.expectTenantScoped(CHAPTER_A, () =>
      repo.chapterUsage(
        CHAPTER_A,
        new Date('2026-11-01T00:00:00Z'),
        new Date('2026-12-01T00:00:00Z'),
      ),
    );
    expect(lines).toEqual([
      {
        task: 'minutes.draft',
        provider: 'anthropic',
        model: 'claude-sonnet-5-5',
        calls: 2,
        inputTokens: 2_000,
        outputTokens: 4_000,
        cachedInputTokens: 0,
        audioSeconds: 0,
        costMicroUsd: 44_000,
        estimatedCostMicroUsd: 0,
        unsettledCalls: 0,
      },
    ]);
  });

  it('the hold sweep takes a time and no chapter: it serves every chapter', async () => {
    await expect(repo.expireHolds(NOW)).resolves.toBe(3);
    expect(harness.rpcCalls).toEqual([
      {
        fn: 'expire_ai_spend_holds',
        args: { p_older_than: NOW.toISOString() },
      },
    ]);
  });
});
