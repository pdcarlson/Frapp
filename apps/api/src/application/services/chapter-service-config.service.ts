import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ServiceConfig } from '#domain/entities/chapter-service-config.entity';
import {
  CHAPTER_CONFIG_REPOSITORY,
  type IChapterConfigRepository,
} from '#domain/repositories/chapter-config.repository.interface';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/**
 * Used when a chapter has no `chapter_service_config` row yet. Mirrors the
 * table's column default (migration 20260809124500), which is itself the rate
 * `ServiceEntryService` hardcoded before the rate became configurable — so an
 * unconfigured chapter awards points exactly as it always did, and no backfill
 * was needed.
 */
export const SERVICE_CONFIG_DEFAULTS: ServiceConfig = {
  minutes_per_point: 60,
};

/**
 * Runtime lookup for a chapter's service-hours points rate.
 *
 * Deliberately separate from `ChapterConfigService`, mirroring how
 * `ChapterWorkflowsService` relates to it: that service carries a runtime
 * import of the ESM-only `@repo/org-archetypes` dist, so injecting it into a
 * domain service would force every downstream unit spec to mock that package.
 * This one touches nothing but the singleton row.
 *
 * `ChapterConfigService.getConfig` performs the same read for *presentation*;
 * this is the read domain logic uses to actually award points.
 */
@Injectable()
export class ChapterServiceConfigService {
  private readonly logger = new Logger(ChapterServiceConfigService.name);

  constructor(
    @Inject(CHAPTER_CONFIG_REPOSITORY)
    private readonly configRepo: IChapterConfigRepository,
  ) {}

  async getConfig(chapterId: string): Promise<ServiceConfig> {
    let row: ServiceConfig | null;
    try {
      row = await this.configRepo.findServiceConfig(chapterId);
    } catch (err) {
      // Fall back to the default rate — but say so: for a chapter that
      // configured a different rate, this awards points at the wrong rate
      // until reads recover.
      //
      // This deliberately DIVERGES from the config endpoint, which fails
      // *closed* on the same table (#1626): `ChapterConfigService.getConfig`
      // feeds `patchConfig`'s prior state and is upserted back as a whole row,
      // so defaulting there resets `minutes_per_point` permanently. This read
      // writes nothing — it prices one service entry — so failing open degrades
      // that entry rather than 500ing approval during a transient blip.
      // `ChapterPointsConfigService` models the same split explicitly as
      // `getConfig` / `getConfigOrThrow`. Do not make either side match the other.
      logThrowable(
        this.logger,
        'warn',
        `chapter_service_config read failed for chapter ${chapterId}; applying default rate (${SERVICE_CONFIG_DEFAULTS.minutes_per_point} min/point)`,
        err,
      );
      return { ...SERVICE_CONFIG_DEFAULTS };
    }

    return { ...SERVICE_CONFIG_DEFAULTS, ...(row ?? {}) };
  }

  /**
   * Minutes of approved service per SERVICE point. Guarded to at least 1: the
   * column's CHECK enforces this, but a value that predates the constraint (or
   * arrives from a hand-edited row) would otherwise divide by zero and award
   * `Infinity` points.
   */
  async getMinutesPerPoint(chapterId: string): Promise<number> {
    const { minutes_per_point } = await this.getConfig(chapterId);
    return Number.isInteger(minutes_per_point) && minutes_per_point >= 1
      ? minutes_per_point
      : SERVICE_CONFIG_DEFAULTS.minutes_per_point;
  }
}
