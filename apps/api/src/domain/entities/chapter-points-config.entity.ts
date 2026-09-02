/**
 * A chapter's points anti-fraud limits (Settings → Points), persisted to
 * `chapter_points_config` (`20260902143000_chapter_points_config.sql`).
 *
 * Keyed by `chapter_id` — the primary key is the chapter, so there is exactly
 * one row per chapter and no separate `id` column, mirroring
 * `ChapterServiceConfig` and `ChapterDuesConfig`.
 *
 * A chapter with no row is not misconfigured: the absent row means "use the
 * defaults" (50 adjustments/hour, flag at ±100), which is what `PointsService`
 * enforced before the limits became configurable. Rows are created lazily on
 * first PATCH.
 *
 * Both limits are described as chapter-configurable in
 * `spec/behavior/points.md` § Anti-Fraud; #394 is where the code caught up.
 */
export interface ChapterPointsConfig {
  chapter_id: string;
  /**
   * Maximum manual point adjustments a single admin may create per rolling
   * hour, across the chapter. Exceeding it returns 429.
   */
  adjustment_rate_limit_per_hour: number;
  /**
   * Absolute point amount at or above which a committed adjustment is marked
   * `metadata.flagged` for review in the Audit tab. This flags a row that was
   * written; it is not the ±100,000 hard ceiling, which rejects the request
   * outright and lives in the DTO.
   */
  anomaly_threshold: number;
  created_at: string;
  updated_at: string;
}
