import { Inject, Injectable, Logger } from '@nestjs/common';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { CHAPTER_POINTS_CONFIG_DEFAULTS } from '@repo/validation';

/**
 * A chapter's points anti-fraud policy, as read and written by the config
 * endpoint.
 *
 * API-facing subset of `chapter_points_config` (no timestamps). Writes use
 * `TablesInsert<'chapter_points_config'>`, same pattern as `ServiceConfig`.
 */
export type PointsConfig = {
  adjustment_rate_limit_per_hour: number;
  anomaly_threshold: number;
};

export const POINTS_CONFIG_FIELDS = [
  'adjustment_rate_limit_per_hour',
  'anomaly_threshold',
] as const satisfies ReadonlyArray<keyof PointsConfig>;

export const POINTS_CONFIG_SELECT = POINTS_CONFIG_FIELDS.join(', ');

/**
 * Used when a chapter has no `chapter_points_config` row yet. Mirrors the
 * table's column defaults (migration 20260902143000), which are themselves the
 * values `PointsService` hardcoded before the limits became configurable — so
 * an unconfigured chapter enforces exactly what it always did, and no backfill
 * was needed.
 *
 * Re-exported from `@repo/validation` rather than declared here: the web reads
 * the same constant to render the active limits, and a second hand-written
 * copy would let the dashboard state a limit the server does not enforce.
 */
export const POINTS_CONFIG_DEFAULTS: PointsConfig =
  CHAPTER_POINTS_CONFIG_DEFAULTS;

/**
 * Runtime lookup for a chapter's points anti-fraud limits.
 *
 * Deliberately separate from `ChapterConfigService`, mirroring how
 * `ChapterServiceConfigService` relates to it: that service carries a runtime
 * import of the ESM-only `@repo/org-archetypes` dist, so injecting it into a
 * domain service would force every downstream unit spec to mock that package.
 * This one touches nothing but the singleton row.
 *
 * `ChapterConfigService.getConfig` performs the same read for *presentation*;
 * this is the read `PointsService.adjustPoints` uses to actually enforce.
 */
@Injectable()
export class ChapterPointsConfigService {
  private readonly logger = new Logger(ChapterPointsConfigService.name);

  constructor(
    @Inject(SUPABASE_CLIENT) private readonly supabase: FrappSupabaseClient,
  ) {}

  /**
   * Read the chapter's limits for **enforcement**, falling back to the
   * defaults field by field.
   *
   * Fails *open* on a read error: an adjustment still goes through, under the
   * default limits. That is the same posture as `ChapterServiceConfigService`,
   * but note it is doing more work here — for a chapter that configured
   * something tighter, a read failure relaxes an anti-fraud control until
   * reads recover, which is why it warns. Never use this as the baseline for
   * a write; see `getConfigOrThrow`.
   */
  async getConfig(chapterId: string): Promise<PointsConfig> {
    const { data, error } = await this.read(chapterId);

    if (error) {
      this.logger.warn(
        `chapter_points_config read failed for chapter ${chapterId}; applying default anti-fraud limits ` +
          `(${POINTS_CONFIG_DEFAULTS.adjustment_rate_limit_per_hour}/hr, threshold ` +
          `${POINTS_CONFIG_DEFAULTS.anomaly_threshold}): ${error.message}`,
      );
      return { ...POINTS_CONFIG_DEFAULTS };
    }

    return this.coerce(data, chapterId);
  }

  /**
   * Read the chapter's limits for the **config endpoint**, which both renders
   * them and uses them as the prior state a PATCH merges onto.
   *
   * Fails *closed*, and that difference is the whole reason this method
   * exists. `patchConfig` upserts the full row, so if a transient read error
   * silently produced the defaults here, an officer editing only one limit
   * would overwrite the other one back to 50/100 — permanently loosening a
   * fraud control — and the audit row would record a `from` state the chapter
   * never actually had. A 500 an officer can retry is strictly better than a
   * silent write of fabricated state.
   */
  async getConfigOrThrow(chapterId: string): Promise<PointsConfig> {
    const { data, error } = await this.read(chapterId);

    if (error) {
      this.logger.error(
        `chapter_points_config read failed for chapter ${chapterId}; refusing to ` +
          `report or write against a fabricated prior state: ${error.message}`,
      );
      throw error;
    }

    return this.coerce(data, chapterId);
  }

  private async read(chapterId: string) {
    return this.supabase
      .from('chapter_points_config')
      .select(POINTS_CONFIG_SELECT)
      .eq('chapter_id', chapterId)
      .maybeSingle();
  }

  /**
   * Each field is validated independently rather than trusting the row: the
   * column CHECKs enforce the `>= 1` floor, but a value that predates the
   * constraint (or arrives from a hand-edited row) must not be able to weaken
   * enforcement. A bad `adjustment_rate_limit_per_hour` of 0 would refuse
   * every adjustment; a bad `anomaly_threshold` of 0 would flag every row.
   * Both degrade to the documented default instead, and say so.
   *
   * Applied on *both* read paths, so what the config endpoint reports is
   * always what enforcement will actually apply. When these diverged, a stored
   * 0 rendered "up to 0 adjustments per hour" on a chapter the server was
   * happily letting make 50, and a PATCH of the other field wrote the 0 back
   * into a CHECK violation the chapter could not clear through the API.
   */
  private coerce(data: unknown, chapterId: string): PointsConfig {
    // `Partial<T>` says a key may be absent, not that its value may be null,
    // so read through a nullable shape rather than letting a null column
    // masquerade as a number.
    const row =
      (data as { [K in keyof PointsConfig]?: number | null } | null) ?? {};
    return {
      adjustment_rate_limit_per_hour: this.sane(
        row.adjustment_rate_limit_per_hour,
        'adjustment_rate_limit_per_hour',
        chapterId,
      ),
      anomaly_threshold: this.sane(
        row.anomaly_threshold,
        'anomaly_threshold',
        chapterId,
      ),
    };
  }

  /**
   * An absent field is the ordinary "no row yet" case and is silent. A field
   * that is present but out of range means the stored row disagrees with its
   * own CHECK constraint, which should be impossible — so that one is warned
   * about before it degrades to the default.
   */
  private sane(
    value: number | undefined | null,
    field: keyof PointsConfig,
    chapterId: string,
  ): number {
    if (value == null) return POINTS_CONFIG_DEFAULTS[field];
    if (Number.isInteger(value) && value >= 1) return value;

    this.logger.warn(
      `chapter_points_config.${field} for chapter ${chapterId} is ${String(value)}, ` +
        `which violates the column's own >= 1 CHECK; applying the default ` +
        `(${POINTS_CONFIG_DEFAULTS[field]}) instead`,
    );
    return POINTS_CONFIG_DEFAULTS[field];
  }
}
