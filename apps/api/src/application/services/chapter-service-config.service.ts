import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';

/**
 * A chapter's service-hours policy, as read and written by the config
 * endpoint.
 *
 * API-facing subset of `chapter_service_config` (no timestamps). Writes use
 * `TablesInsert<'chapter_service_config'>`, same pattern as `DuesConfig`.
 */
export type ServiceConfig = {
  minutes_per_point: number;
};

export const SERVICE_CONFIG_FIELDS = [
  'minutes_per_point',
] as const satisfies ReadonlyArray<keyof ServiceConfig>;

export const SERVICE_CONFIG_SELECT = SERVICE_CONFIG_FIELDS.join(', ');

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
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  async getConfig(chapterId: string): Promise<ServiceConfig> {
    const { data, error } = await this.supabase
      .from('chapter_service_config')
      .select(SERVICE_CONFIG_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();

    if (error) {
      // Fall back to the default rate, matching the config endpoint's read
      // posture — but say so: for a chapter that configured a different rate,
      // this awards points at the wrong rate until reads recover.
      this.logger.warn(
        `chapter_service_config read failed for chapter ${chapterId}; applying default rate (${SERVICE_CONFIG_DEFAULTS.minutes_per_point} min/point): ${error.message}`,
      );
      return { ...SERVICE_CONFIG_DEFAULTS };
    }

    return {
      ...SERVICE_CONFIG_DEFAULTS,
      ...((data as Partial<ServiceConfig> | null) ?? {}),
    };
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
