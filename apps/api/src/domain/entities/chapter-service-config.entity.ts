/**
 * A chapter's service-hours policy (Settings → Service), persisted to
 * `chapter_service_config` (`20260809124500_service_hours_config_and_leaderboard.sql`).
 *
 * Keyed by `chapter_id` — the primary key is the chapter, so there is exactly
 * one row per chapter and no separate `id` column, mirroring
 * `ChapterDuesConfig`.
 *
 * A chapter with no row is not misconfigured: the absent row means "use the
 * default rate" (60 minutes per point), which is what the API awarded before
 * the rate became configurable. Rows are created lazily on first PATCH.
 */
export interface ChapterServiceConfig {
  chapter_id: string;
  /**
   * Minutes of approved service that earn one SERVICE point. Named to match
   * `study_geofences.minutes_per_point`, the established spelling for this
   * conversion in the schema (spec/architecture/README.md).
   */
  minutes_per_point: number;
  created_at: string;
  updated_at: string;
}
