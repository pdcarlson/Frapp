import { Test, TestingModule } from '@nestjs/testing';
import { ChapterServiceConfigService } from './chapter-service-config.service';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';

const CHAPTER_ID = 'ch-1';

/**
 * Supabase stub resolving the singleton `chapter_service_config` read through
 * `maybeSingle()`. `error` models a read failure so the fallback posture can be
 * asserted.
 */
function makeSupabase(
  row: Record<string, unknown> | null,
  error: { message: string } | null = null,
) {
  const maybeSingle = jest.fn().mockResolvedValue({ data: row, error });
  const eq = jest.fn().mockReturnValue({ maybeSingle });
  const builder: Record<string, jest.Mock> = {};
  builder.select = jest.fn().mockReturnValue({ eq });
  const from = jest.fn().mockReturnValue(builder);
  return { from, eq, maybeSingle };
}

async function buildService(supabase: { from: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChapterServiceConfigService,
      { provide: SUPABASE_CLIENT, useValue: supabase },
    ],
  }).compile();
  return module.get(ChapterServiceConfigService);
}

describe('ChapterServiceConfigService', () => {
  describe('getConfig', () => {
    it('returns the default rate when the chapter has no row', async () => {
      const service = await buildService(makeSupabase(null));

      await expect(service.getConfig(CHAPTER_ID)).resolves.toEqual({
        minutes_per_point: 60,
      });
    });

    it('returns the chapter override when a row exists', async () => {
      const service = await buildService(
        makeSupabase({ minutes_per_point: 20 }),
      );

      await expect(service.getConfig(CHAPTER_ID)).resolves.toEqual({
        minutes_per_point: 20,
      });
    });

    it('falls back to the default rather than throwing when the read fails', async () => {
      // Approval must not 500 because a config read blipped; it awards at the
      // default rate and the service logs a warning.
      const service = await buildService(
        makeSupabase(null, { message: 'connection reset' }),
      );

      await expect(service.getConfig(CHAPTER_ID)).resolves.toEqual({
        minutes_per_point: 60,
      });
    });

    it('scopes the read to the chapter', async () => {
      const supabase = makeSupabase(null);
      const service = await buildService(supabase);

      await service.getConfig(CHAPTER_ID);

      expect(supabase.from).toHaveBeenCalledWith('chapter_service_config');
      expect(supabase.eq).toHaveBeenCalledWith('chapter_id', CHAPTER_ID);
    });
  });

  describe('getMinutesPerPoint', () => {
    it('returns the configured rate', async () => {
      const service = await buildService(
        makeSupabase({ minutes_per_point: 30 }),
      );

      await expect(service.getMinutesPerPoint(CHAPTER_ID)).resolves.toBe(30);
    });

    it.each([
      ['zero', 0],
      ['negative', -10],
      ['fractional', 12.5],
    ])(
      'guards a %s rate back to the default so the award never divides by zero',
      async (_label, stored) => {
        // The column CHECK prevents these, but a row predating the constraint
        // — or hand-edited — would otherwise award Infinity or a fractional
        // floor.
        const service = await buildService(
          makeSupabase({ minutes_per_point: stored }),
        );

        await expect(service.getMinutesPerPoint(CHAPTER_ID)).resolves.toBe(60);
      },
    );
  });
});
