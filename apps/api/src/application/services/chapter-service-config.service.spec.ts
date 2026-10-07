import { Test, TestingModule } from '@nestjs/testing';
import { ChapterServiceConfigService } from './chapter-service-config.service';
import { CHAPTER_CONFIG_REPOSITORY } from '#domain/repositories/chapter-config.repository.interface';
import { SupabaseQueryError } from '../../infrastructure/supabase/supabase-query-error';

const CHAPTER_ID = 'ch-1';

/**
 * Repository stub for the singleton `chapter_service_config` read. `error`
 * rejects the way the repository does on a query error, so the fallback
 * posture can be asserted.
 */
function makeConfigRepo(
  row: { minutes_per_point: number } | null,
  error: { message: string } | null = null,
) {
  return {
    findServiceConfig: error
      ? jest.fn().mockRejectedValue(new SupabaseQueryError(error))
      : jest.fn().mockResolvedValue(row),
  };
}

async function buildService(configRepo: { findServiceConfig: jest.Mock }) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ChapterServiceConfigService,
      { provide: CHAPTER_CONFIG_REPOSITORY, useValue: configRepo },
    ],
  }).compile();
  return module.get(ChapterServiceConfigService);
}

describe('ChapterServiceConfigService', () => {
  describe('getConfig', () => {
    it('returns the default rate when the chapter has no row', async () => {
      const service = await buildService(makeConfigRepo(null));

      await expect(service.getConfig(CHAPTER_ID)).resolves.toEqual({
        minutes_per_point: 60,
      });
    });

    it('returns the chapter override when a row exists', async () => {
      const service = await buildService(
        makeConfigRepo({ minutes_per_point: 20 }),
      );

      await expect(service.getConfig(CHAPTER_ID)).resolves.toEqual({
        minutes_per_point: 20,
      });
    });

    it('falls back to the default rather than throwing when the read fails', async () => {
      // Approval must not 500 because a config read blipped; it awards at the
      // default rate and the service logs a warning.
      const service = await buildService(
        makeConfigRepo(null, { message: 'connection reset' }),
      );

      await expect(service.getConfig(CHAPTER_ID)).resolves.toEqual({
        minutes_per_point: 60,
      });
    });

    it('scopes the read to the chapter', async () => {
      const repo = makeConfigRepo(null);
      const service = await buildService(repo);

      await service.getConfig(CHAPTER_ID);

      expect(repo.findServiceConfig).toHaveBeenCalledWith(CHAPTER_ID);
    });
  });

  describe('getMinutesPerPoint', () => {
    it('returns the configured rate', async () => {
      const service = await buildService(
        makeConfigRepo({ minutes_per_point: 30 }),
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
          makeConfigRepo({ minutes_per_point: stored }),
        );

        await expect(service.getMinutesPerPoint(CHAPTER_ID)).resolves.toBe(60);
      },
    );
  });
});
