import type { IAiUsageRepository } from '#domain/repositories/ai-usage.repository.interface';
import * as reporting from '../../infrastructure/observability/report-caught-failure';
import {
  AI_SPEND_HOLD_TTL_MS,
  AiSpendSweepService,
} from './ai-spend-sweep.service';

const NOW = Date.parse('2026-11-12T10:00:00Z');

describe('AiSpendSweepService', () => {
  const original = process.env.AI_ENABLED;
  let report: jest.SpyInstance;
  let ledger: jest.Mocked<IAiUsageRepository>;
  let sweep: AiSpendSweepService;

  beforeEach(() => {
    report = jest
      .spyOn(reporting, 'reportCaughtFailure')
      .mockImplementation(() => undefined);
    ledger = {
      reserve: jest.fn(),
      settle: jest.fn(),
      expireHolds: jest.fn().mockResolvedValue(0),
      chapterUsage: jest.fn(),
    };
    sweep = new AiSpendSweepService(ledger);
  });

  afterEach(() => {
    if (original === undefined) delete process.env.AI_ENABLED;
    else process.env.AI_ENABLED = original;
    report.mockRestore();
  });

  it('touches nothing while AI is off', async () => {
    delete process.env.AI_ENABLED;
    await expect(sweep.sweep(NOW)).resolves.toBe(0);
    expect(ledger.expireHolds).not.toHaveBeenCalled();
  });

  it('expires holds older than an hour, quietly when there are none', async () => {
    process.env.AI_ENABLED = 'true';
    await sweep.sweep(NOW);
    expect(ledger.expireHolds).toHaveBeenCalledWith(
      new Date(NOW - AI_SPEND_HOLD_TTL_MS),
    );
    expect(report).not.toHaveBeenCalled();
  });

  it('reports holds that expired', async () => {
    process.env.AI_ENABLED = 'true';
    ledger.expireHolds.mockResolvedValue(2);
    await expect(sweep.sweep(NOW)).resolves.toBe(2);
    expect(report).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        level: 'warning',
        site: 'ai-spend-hold-expired',
      }),
    );
  });
});
