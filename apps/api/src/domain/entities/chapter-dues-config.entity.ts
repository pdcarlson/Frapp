/**
 * A chapter's dues plan (Settings → Dues), persisted to
 * `chapter_dues_config` (`20260523120000_chapter_customization.sql`).
 *
 * Keyed by `chapter_id` — the primary key is the chapter, so there is exactly
 * one row per chapter and no separate `id` column.
 *
 * Every monetary field is in **cents** (integer) to avoid float rounding.
 *
 * The shape here is the post-`20260530193000_chapter_dues_config_align_spec`
 * one, not the original stub: that migration re-mapped `cadence` to the
 * spec's three values and added `installment_count`. Mirrors
 * `ChapterDuesConfigSchema` in `packages/validation`, which validates writes.
 */
export type DuesCadence = 'monthly' | 'per_semester' | 'per_quarter';

export interface ChapterDuesConfig {
  chapter_id: string;
  cadence: DuesCadence;
  active_amount_cents: number;
  new_member_amount_cents: number;
  alumni_amount_cents: number;
  /** The spec's installment "toggle"; `installment_count` is its count. */
  installments_allowed: boolean;
  installment_count: number;
  late_fee_cents: number;
  /** Days past due before the late fee applies. */
  grace_days: number;
  scholarship_pool_cents: number;
  created_at: string;
  updated_at: string;
}

/**
 * The dues plan as the config endpoint reads and writes it: the row without
 * its key and timestamps. `DUES_CONFIG_FIELDS` is the column list both the
 * repository's select and `ChapterConfigService`'s PATCH merge walk, so the
 * two cannot disagree about which columns make up the plan.
 */
export type DuesConfig = Omit<
  ChapterDuesConfig,
  'chapter_id' | 'created_at' | 'updated_at'
>;

export const DUES_CONFIG_FIELDS = [
  'cadence',
  'active_amount_cents',
  'new_member_amount_cents',
  'alumni_amount_cents',
  'installments_allowed',
  'installment_count',
  'late_fee_cents',
  'grace_days',
  'scholarship_pool_cents',
] as const satisfies ReadonlyArray<keyof DuesConfig>;
