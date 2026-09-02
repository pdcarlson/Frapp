import { Test, TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import {
  ChapterPointsConfigService,
  POINTS_CONFIG_DEFAULTS,
} from './chapter-points-config.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

/**
 * Minimal stand-in for the one query shape this service issues:
 * `.from(...).select(...).eq(...).maybeSingle()`.
 */
function supabaseReturning(result: { data: unknown; error: unknown }) {
  const maybeSingle = jest.fn().mockResolvedValue(result);
  const eq = jest.fn(() => ({ maybeSingle }));
  const select = jest.fn(() => ({ eq }));
  const from = jest.fn(() => ({ select }));
  return { client: { from }, from, select, eq, maybeSingle };
}

describe('ChapterPointsConfigService', () => {
  let warn: jest.SpyInstance;

  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function build(result: { data: unknown; error: unknown }) {
    const supabase = supabaseReturning(result);
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ChapterPointsConfigService,
        { provide: SUPABASE_CLIENT, useValue: supabase.client },
      ],
    }).compile();
    return {
      service: module.get(ChapterPointsConfigService),
      supabase,
    };
  }

  it('returns the configured limits when a row exists', async () => {
    const { service, supabase } = await build({
      data: { adjustment_rate_limit_per_hour: 10, anomaly_threshold: 250 },
      error: null,
    });

    await expect(service.getConfig('ch-1')).resolves.toEqual({
      adjustment_rate_limit_per_hour: 10,
      anomaly_threshold: 250,
    });
    expect(supabase.from).toHaveBeenCalledWith('chapter_points_config');
    expect(supabase.eq).toHaveBeenCalledWith('chapter_id', 'ch-1');
    expect(warn).not.toHaveBeenCalled();
  });

  // An absent row is the ordinary state, not a fault: it means "use the
  // defaults", which is why nothing provisions rows at onboarding.
  it('returns the defaults, silently, when the chapter has no row', async () => {
    const { service } = await build({ data: null, error: null });

    await expect(service.getConfig('ch-1')).resolves.toEqual(
      POINTS_CONFIG_DEFAULTS,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back per field when a row sets only one limit', async () => {
    const { service } = await build({
      data: { anomaly_threshold: 250 },
      error: null,
    });

    await expect(service.getConfig('ch-1')).resolves.toEqual({
      adjustment_rate_limit_per_hour:
        POINTS_CONFIG_DEFAULTS.adjustment_rate_limit_per_hour,
      anomaly_threshold: 250,
    });
  });

  // A read failure silently applying the looser default is a weakening of an
  // anti-fraud control for a chapter that configured something tighter, so it
  // has to reach the log.
  it('warns and applies the defaults when the read fails', async () => {
    const { service } = await build({
      data: null,
      error: { message: 'connection reset' },
    });

    await expect(service.getConfig('ch-1')).resolves.toEqual(
      POINTS_CONFIG_DEFAULTS,
    );
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('chapter_points_config read failed'),
    );
  });

  // The column CHECKs make these unreachable through the API. A row that
  // predates the constraint or was hand-edited must still not be able to
  // brick the ledger (rate 0 refuses every adjustment) or drown the Audit tab
  // (threshold 0 flags every row).
  it.each([
    ['adjustment_rate_limit_per_hour', 0],
    ['adjustment_rate_limit_per_hour', -5],
    ['anomaly_threshold', 0],
    ['anomaly_threshold', 2.5],
  ])('warns and defaults on an out-of-range %s of %s', async (field, value) => {
    const { service } = await build({
      data: { ...POINTS_CONFIG_DEFAULTS, [field]: value },
      error: null,
    });

    const config = await service.getConfig('ch-1');

    expect(config[field as keyof typeof config]).toBe(
      POINTS_CONFIG_DEFAULTS[field as keyof typeof POINTS_CONFIG_DEFAULTS],
    );
    expect(warn).toHaveBeenCalledWith(expect.stringContaining(field));
  });

  it('keeps the defaults aligned with what PointsService used to hardcode', () => {
    expect(POINTS_CONFIG_DEFAULTS).toEqual({
      adjustment_rate_limit_per_hour: 50,
      anomaly_threshold: 100,
    });
  });
});
