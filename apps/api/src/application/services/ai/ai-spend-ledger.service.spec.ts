import type { AiCallDescriptor } from '#domain/adapters/ai-call-context';
import type { AiUsageRecord } from '#domain/adapters/ai-usage-recorder.interface';
import type { IAiUsageRepository } from '#domain/repositories/ai-usage.repository.interface';
import * as reporting from '../../../infrastructure/observability/report-caught-failure';
import { AiSpendLedgerService } from './ai-spend-ledger.service';

const CALL: AiCallDescriptor = {
  chapterId: 'chapter-1',
  actingUserId: 'user-1',
  task: 'minutes.draft',
  family: 'meetings',
  provider: 'anthropic',
  model: 'claude-sonnet-5-5',
  promptVersion: 'minutes@v1',
};

const ESTIMATE = {
  inputTokens: 1_000,
  maxOutputTokens: 16_000,
  maxCostMicroUsd: 162_000,
};

function usage(overrides: Partial<AiUsageRecord> = {}): AiUsageRecord {
  return {
    ...CALL,
    reservationId: 'hold-1',
    outcome: 'completed',
    errorKind: null,
    inputTokens: 900,
    outputTokens: 2_000,
    cachedInputTokens: 0,
    costMicroUsd: 21_800,
    latencyMs: 4_000,
    ...overrides,
  };
}

function harness() {
  const ledger: jest.Mocked<IAiUsageRepository> = {
    reserve: jest.fn().mockResolvedValue({
      granted: true,
      reservationId: 'hold-1',
      platformSpentBeforeMicroUsd: 0,
      platformSpentAfterMicroUsd: ESTIMATE.maxCostMicroUsd,
    }),
    settle: jest.fn().mockResolvedValue('settled'),
    expireHolds: jest.fn(),
    chapterUsage: jest.fn().mockResolvedValue([]),
  };
  return { ledger, service: new AiSpendLedgerService(ledger) };
}

const CAP_VARS = [
  'AI_CHAPTER_MONTHLY_CAP_USD',
  'AI_MEMBER_DAILY_CAP_USD',
  'AI_ANTHROPIC_MONTHLY_CAP_USD',
  'AI_GOOGLE_MONTHLY_CAP_USD',
] as const;

describe('AiSpendLedgerService', () => {
  const saved = Object.fromEntries(CAP_VARS.map((v) => [v, process.env[v]]));
  let report: jest.SpyInstance;

  beforeEach(() => {
    for (const v of CAP_VARS) delete process.env[v];
    report = jest
      .spyOn(reporting, 'reportCaughtFailure')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const v of CAP_VARS) {
      if (saved[v] === undefined) delete process.env[v];
      else process.env[v] = saved[v];
    }
    report.mockRestore();
  });

  describe('reserve', () => {
    it('holds the worst case against the three default caps', async () => {
      const { ledger, service } = harness();

      await expect(service.reserve(CALL, ESTIMATE)).resolves.toEqual({
        granted: true,
        reservationId: 'hold-1',
      });
      expect(ledger.reserve).toHaveBeenCalledWith(
        CALL,
        162_000,
        {
          chapterMonthlyMicroUsd: 25_000_000,
          memberDailyMicroUsd: 2_000_000,
          platformMonthlyMicroUsd: 150_000_000,
        },
        expect.any(Date),
      );
      expect(report).not.toHaveBeenCalled();
    });

    it('reads the caps from the environment on each call', async () => {
      const { ledger, service } = harness();
      process.env.AI_CHAPTER_MONTHLY_CAP_USD = '40';
      process.env.AI_MEMBER_DAILY_CAP_USD = '0.50';
      process.env.AI_ANTHROPIC_MONTHLY_CAP_USD = '180';

      await service.reserve(CALL, ESTIMATE);
      expect(ledger.reserve.mock.calls[0]?.[2]).toEqual({
        chapterMonthlyMicroUsd: 40_000_000,
        memberDailyMicroUsd: 500_000,
        platformMonthlyMicroUsd: 180_000_000,
      });
    });

    it('holds a scripted call against the chapter and member caps only', async () => {
      const { ledger, service } = harness();
      await service.reserve({ ...CALL, provider: 'scripted' }, ESTIMATE);
      expect(ledger.reserve.mock.calls[0]?.[2]).toMatchObject({
        platformMonthlyMicroUsd: null,
      });
    });

    it.each(['chapter_cap', 'member_cap'] as const)(
      'refuses at the %s without paging anyone',
      async (cap) => {
        const { ledger, service } = harness();
        ledger.reserve.mockResolvedValue({ granted: false, cap });
        await expect(service.reserve(CALL, ESTIMATE)).resolves.toEqual({
          granted: false,
          reason: cap,
        });
        expect(report).not.toHaveBeenCalled();
      },
    );

    it('refuses at the platform cap and reports it', async () => {
      const { ledger, service } = harness();
      ledger.reserve.mockResolvedValue({ granted: false, cap: 'platform_cap' });
      await expect(service.reserve(CALL, ESTIMATE)).resolves.toEqual({
        granted: false,
        reason: 'platform_cap',
      });
      expect(report).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          level: 'error',
          site: 'ai-spend-platform-cap-reached',
          tags: { provider: 'anthropic' },
        }),
      );
    });

    it('reports each pool line once a month, however often spend re-crosses it', async () => {
      const { ledger, service } = harness();
      const hold = (before: number, after: number) =>
        ledger.reserve.mockResolvedValueOnce({
          granted: true,
          reservationId: 'hold',
          platformSpentBeforeMicroUsd: before,
          platformSpentAfterMicroUsd: after,
        });
      const sites = () =>
        report.mock.calls.map(([, f]) => (f as { site: string }).site);

      // $150 pool: from $70 to $115.5 crosses 50% ($75) and 75% ($112.50).
      hold(70_000_000, 115_500_000);
      await service.reserve(CALL, ESTIMATE);
      expect(sites()).toEqual([
        'ai-spend-platform-pool-50',
        'ai-spend-platform-pool-75',
      ]);

      // The call settles low, spend falls back under 75%, and the next hold
      // crosses it again: no second report.
      report.mockClear();
      hold(112_400_000, 112_650_000);
      await service.reserve(CALL, ESTIMATE);
      expect(report).not.toHaveBeenCalled();

      // Another provider has lines of its own.
      hold(0, 30_000_000);
      await service.reserve({ ...CALL, provider: 'google' }, ESTIMATE);
      expect(sites()).toEqual(['ai-spend-platform-pool-50']);
    });

    it('reports 90% at error level, so it reaches Paul', async () => {
      const { ledger, service } = harness();
      ledger.reserve.mockResolvedValue({
        granted: true,
        reservationId: 'hold-1',
        platformSpentBeforeMicroUsd: 134_900_000,
        platformSpentAfterMicroUsd: 135_000_000,
      });
      await service.reserve(CALL, ESTIMATE);
      expect(report).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          level: 'error',
          site: 'ai-spend-platform-pool-90',
        }),
      );
    });

    it('a new month reports its lines again', async () => {
      jest.useFakeTimers({ now: new Date('2026-11-30T23:00:00Z') });
      try {
        const { ledger, service } = harness();
        ledger.reserve.mockResolvedValue({
          granted: true,
          reservationId: 'hold-1',
          platformSpentBeforeMicroUsd: 0,
          platformSpentAfterMicroUsd: 80_000_000,
        });
        await service.reserve(CALL, ESTIMATE);
        jest.setSystemTime(new Date('2026-12-01T01:00:00Z'));
        await service.reserve(CALL, ESTIMATE);
        // 80 of 150 is past 50% only: once in November, once in December.
        expect(report).toHaveBeenCalledTimes(2);
      } finally {
        jest.useRealTimers();
      }
    });
  });

  describe('record', () => {
    it('settles the hold with what the call used', async () => {
      const { ledger, service } = harness();
      const record = usage();
      await service.record(record);
      expect(ledger.settle).toHaveBeenCalledWith(
        record,
        false,
        expect.any(Date),
      );
    });

    it.each([
      'aborted',
      'timeout',
      'connection',
      'overloaded',
      'unknown',
    ] as const)(
      'charges the whole hold for an %s failure the provider never reported',
      async (errorKind) => {
        const { ledger, service } = harness();
        await service.record(
          usage({
            outcome: 'error',
            errorKind,
            inputTokens: 0,
            outputTokens: 0,
            costMicroUsd: 0,
          }),
        );
        expect(ledger.settle.mock.calls[0]?.[1]).toBe(true);
      },
    );

    it('trusts the counts when the provider reported them before failing', async () => {
      const { ledger, service } = harness();
      await service.record(
        usage({ outcome: 'error', errorKind: 'timeout', outputTokens: 300 }),
      );
      expect(ledger.settle.mock.calls[0]?.[1]).toBe(false);
    });

    it.each([
      'rate_limited',
      'auth',
      'invalid_request',
      'unsupported',
    ] as const)(
      'charges nothing for a call refused at the door (%s)',
      async (errorKind) => {
        const { ledger, service } = harness();
        await service.record(
          usage({
            outcome: 'error',
            errorKind,
            inputTokens: 0,
            outputTokens: 0,
            costMicroUsd: 0,
          }),
        );
        expect(ledger.settle.mock.calls[0]?.[1]).toBe(false);
      },
    );

    it('records a call made with no hold as it is', async () => {
      const { ledger, service } = harness();
      ledger.settle.mockResolvedValue('inserted');
      await service.record(
        usage({
          reservationId: null,
          outcome: 'error',
          errorKind: 'aborted',
          inputTokens: 0,
          outputTokens: 0,
        }),
      );
      expect(ledger.settle.mock.calls[0]?.[1]).toBe(false);
      expect(report).not.toHaveBeenCalled();
    });

    it('reports a settlement that matched no hold, and does not throw', async () => {
      const { ledger, service } = harness();
      ledger.settle.mockResolvedValue('missing');
      await expect(service.record(usage())).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          level: 'warning',
          site: 'ai-spend-settle-missing',
        }),
      );
    });

    it('lets a ledger failure through, so the gateway does not return unrecorded spend', async () => {
      const { ledger, service } = harness();
      ledger.settle.mockRejectedValue(new Error('db down'));
      await expect(service.record(usage())).rejects.toThrow('db down');
    });
  });

  describe('chapterUsage', () => {
    it('sums the calendar month (UTC) that holds the date', async () => {
      const { ledger, service } = harness();
      ledger.chapterUsage.mockResolvedValue([
        {
          task: 'minutes.draft',
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          calls: 3,
          inputTokens: 3_000,
          outputTokens: 6_000,
          cachedInputTokens: 0,
          audioSeconds: 0,
          costMicroUsd: 66_000,
          estimatedCostMicroUsd: 0,
          unsettledCalls: 0,
        },
        {
          task: 'ask.answer',
          provider: 'anthropic',
          model: 'claude-sonnet-5-5',
          calls: 2,
          inputTokens: 0,
          outputTokens: 0,
          cachedInputTokens: 0,
          audioSeconds: 0,
          costMicroUsd: 80_000,
          estimatedCostMicroUsd: 80_000,
          unsettledCalls: 0,
        },
      ]);

      const result = await service.chapterUsage(
        'chapter-1',
        new Date('2026-12-31T23:30:00Z'),
      );

      expect(ledger.chapterUsage).toHaveBeenCalledWith(
        'chapter-1',
        new Date('2026-12-01T00:00:00Z'),
        new Date('2027-01-01T00:00:00Z'),
      );
      expect(result).toMatchObject({
        totalCostMicroUsd: 146_000,
        estimatedCostMicroUsd: 80_000,
      });
    });
  });
});
