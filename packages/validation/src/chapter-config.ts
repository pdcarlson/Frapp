import { z } from "zod";
import { ChapterBrandingSchema } from "./chapter-branding";
import { POINTS_ADJUSTMENT_MAX } from "./field-limits";

// ── Chapter config schemas (Chunk 02) ─────────────────────────────────────────

/** Reusable nonnegative-cents validator. Rejects NaN and negative values. */
const centsAmount = z.number().int().nonnegative();

export const ChapterDuesConfigSchema = z.object({
  cadence: z.enum(["monthly", "per_semester", "per_quarter"]),
  active_amount_cents: centsAmount,
  new_member_amount_cents: centsAmount,
  alumni_amount_cents: centsAmount,
  installments_allowed: z.boolean(),
  installment_count: z.number().int().min(1),
  late_fee_cents: centsAmount,
  grace_days: z.number().int().nonnegative(),
  scholarship_pool_cents: centsAmount,
});

/**
 * Ceiling on the configurable hourly adjustment rate. An unbounded value would
 * overflow `int4` on the upsert (a raw Postgres 22003 surfacing as a 500 after
 * a partial write), and short of that would simply switch the control off.
 */
export const ADJUSTMENT_RATE_LIMIT_MAX = 1000;

/**
 * A chapter's points anti-fraud limits (#394 — `spec/behavior/points.md`
 * § Anti-Fraud), persisted to `chapter_points_config`.
 *
 * Both floors are `min(1)`, mirroring the column CHECKs and the API DTO: a
 * rate limit of 0 refuses every adjustment with no way back out through the
 * append-only ledger, and a threshold of 0 flags every row.
 */
export const ChapterPointsConfigSchema = z.object({
  adjustment_rate_limit_per_hour: z
    .number()
    .int()
    .min(1)
    .max(ADJUSTMENT_RATE_LIMIT_MAX),
  // Ceiling is the ledger's own per-row bound: an adjustment can never exceed
  // +/-POINTS_ADJUSTMENT_MAX, so a threshold above it could never fire.
  anomaly_threshold: z.number().int().min(1).max(POINTS_ADJUSTMENT_MAX),
});

/**
 * A chapter's service-hours rate (`chapter_service_config`), as the config
 * PATCH takes it. The bounds mirror the API's `ServiceConfigDto`: at least 1
 * (a rate of 0 would divide by zero when awarding), and no more than an
 * entry's own duration cap, above which no entry could earn a point.
 */
export const ChapterServiceConfigSchema = z.object({
  minutes_per_point: z.number().int().min(1).max(POINTS_ADJUSTMENT_MAX),
});
export type ChapterServiceConfig = z.infer<typeof ChapterServiceConfigSchema>;

/**
 * What a chapter with no `chapter_points_config` row enforces — the values
 * `PointsService` hardcoded before the limits became configurable, which is
 * what makes the migration backfill-free.
 *
 * Lives here, in the package both `apps/api` and `packages/hooks` already
 * depend on, so the API's enforcement default and the number the web renders
 * cannot drift apart. They previously would have: a hand-copied frontend
 * constant compiles fine forever while the server default moves, and the
 * dashboard would then state an anti-fraud limit the server does not apply.
 * The migration's column defaults are the third copy and the one that cannot
 * import this; `chapter-points-config.service.spec.ts` pins them together.
 */
export const CHAPTER_POINTS_CONFIG_DEFAULTS: ChapterPointsConfig = {
  adjustment_rate_limit_per_hour: 50,
  anomaly_threshold: 100,
};

/**
 * A single workflow override submitted from Settings → Workflows. `key`
 * identifies a workflow in the chapter's catalog; `threshold` guard-parses to a
 * nonnegative integer (NaN/negative rejected — never stored).
 */
export const ChapterWorkflowConfigSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  threshold: z.number().int().nonnegative().optional(),
});

/**
 * A chapter custom *field* (Settings → Fields), persisted to
 * `chapter_custom_fields`. The set of field types and visibility tiers mirrors
 * the table's CHECK constraints (`supabase/migrations/20260523120000`).
 */
export const CustomFieldTypeSchema = z.enum([
  "text",
  "number",
  "decimal",
  "phone",
  "select",
  "boolean",
]);

export const CustomFieldVisibilitySchema = z.enum([
  "self",
  "chapter",
  "exec",
  "president",
]);

/**
 * Type-specific configuration stored in the `options` jsonb column.
 * `choices` carries a `select` field's option list; `max_length` is an optional
 * constraint for `text`. Other types carry no config (the column is null).
 */
export const CustomFieldOptionsSchema = z
  .object({
    choices: z.array(z.string().min(1)).optional(),
    max_length: z.number().int().positive().optional(),
  })
  .strict();

export const ChapterCustomFieldSchema = z.object({
  id: z.string(),
  chapter_id: z.string(),
  key: z.string(),
  label: z.string(),
  type: CustomFieldTypeSchema,
  required: z.boolean(),
  visibility: CustomFieldVisibilitySchema,
  sensitive: z.boolean(),
  options: CustomFieldOptionsSchema.nullable(),
  sort: z.number().int().nonnegative(),
  created_at: z.string(),
  updated_at: z.string(),
});

/**
 * Body for `POST /custom-fields`. `key` is a lowercase slug unique per chapter.
 * A `select` field must declare a non-empty `choices` list.
 */
export const CreateCustomFieldSchema = z
  .object({
    key: z
      .string()
      .min(1)
      .regex(
        /^[a-z0-9_]+$/,
        "key must be lowercase letters, numbers, underscores",
      ),
    label: z.string().min(1),
    type: CustomFieldTypeSchema,
    required: z.boolean().optional(),
    visibility: CustomFieldVisibilitySchema.optional(),
    sensitive: z.boolean().optional(),
    options: CustomFieldOptionsSchema.optional(),
    sort: z.number().int().nonnegative().optional(),
  })
  .refine((v) => v.type !== "select" || (v.options?.choices?.length ?? 0) > 0, {
    message: "A select field requires a non-empty options.choices list",
    path: ["options", "choices"],
  });

/** Body for `PATCH /custom-fields/:id` (`key` and `type` are immutable). */
export const UpdateCustomFieldSchema = z.object({
  label: z.string().min(1).optional(),
  required: z.boolean().optional(),
  visibility: CustomFieldVisibilitySchema.optional(),
  sensitive: z.boolean().optional(),
  options: CustomFieldOptionsSchema.nullable().optional(),
  sort: z.number().int().nonnegative().optional(),
});

export const PatchChapterConfigSchema = z.object({
  org_archetype: z.string().optional(),
  // Zod 4: `z.record` takes (key, value). The one-arg form was Zod 3.
  enabled_modules: z.record(z.string(), z.boolean()).optional(),
  vocabulary: z.record(z.string(), z.string()).optional(),
  branding: ChapterBrandingSchema,
  beta_config: z
    .object({
      enabled: z.boolean(),
      style: z.enum([
        "sidebar_pill",
        "top_banner",
        "corner_badge",
        "breadcrumb_pill",
      ]),
    })
    .optional(),
  dues: ChapterDuesConfigSchema.optional(),
  // Partial by design: an officer may move one limit without restating the
  // other, and the API merges onto the stored row.
  points: ChapterPointsConfigSchema.partial().optional(),
  service: ChapterServiceConfigSchema.partial().optional(),
  workflows: z.array(ChapterWorkflowConfigSchema).optional(),
  // Per-chapter analytics opt-out (data-retention.md #analytics-events-pseudonymous).
  analytics_opt_out: z.boolean().optional(),
  // #422: role new invites default to. `.nullable()` before `.optional()` is
  // load-bearing — null is a real value here (clear the default) and must
  // survive the parse, while absent means "don't touch it". The API rejects a
  // uuid that is not one of this chapter's roles with a 400.
  default_invite_role_id: z.string().uuid().nullable().optional(),
  // #4959: where the happy-birthday posts go; null turns them off.
  birthday_channel_id: z.string().uuid().nullable().optional(),
});

export type ChapterDuesConfig = z.infer<typeof ChapterDuesConfigSchema>;
export type ChapterPointsConfig = z.infer<typeof ChapterPointsConfigSchema>;
export type PatchChapterConfig = z.infer<typeof PatchChapterConfigSchema>;
export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;
export type CustomFieldVisibility = z.infer<typeof CustomFieldVisibilitySchema>;
export type ChapterCustomField = z.infer<typeof ChapterCustomFieldSchema>;
export type CreateCustomField = z.infer<typeof CreateCustomFieldSchema>;
export type UpdateCustomField = z.infer<typeof UpdateCustomFieldSchema>;
