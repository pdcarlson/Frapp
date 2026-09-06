import {
  IsArray,
  Max,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { POINTS_ADJUSTMENT_MAX } from '@repo/validation';
import { Type } from 'class-transformer';
import type { DuesCadence } from '#domain/entities/chapter-dues-config.entity';

/** Matches the `accent_color` column's own validation in `chapter.dto.ts`. */
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * One colour: the accent engine's seed. A chapter used to set two — a `dark`
 * sidebar colour alongside the accent — but `dark` only ever fed the legacy
 * `derivePalette` token map, and both went in the #920 slice-9 cutover. Signet
 * derives every accent role from this single seed, and the neutral ladder
 * (backgrounds, borders, sidebar) is fixed rather than branded:
 * `spec/ui/design-system/accent-engine.md` §1 and §5.
 *
 * Format-validated but NOT contrast-gated — the raw seed never paints UI.
 * Reasoning and the measured impact of gating it: `spec/behavior/branding.md`.
 *
 * The format check is not cosmetic. This was a bare `@IsString()`, so a value
 * like `"crimson"` reached the engine, which silently substituted a fallback —
 * the #840 failure mode, where 50 seed rows missing a leading `#` all became
 * one platform colour with nothing recording it.
 */
export class BrandingColorsDto {
  @ApiPropertyOptional({
    example: '#C9A56F',
    pattern: HEX_COLOR_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_PATTERN, {
    message: 'accent must be a hex color (#RRGGBB)',
  })
  accent?: string;
}

export class BrandingDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  greek_letters?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  designation?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  school_short?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1776)
  founded_at?: number;

  @ApiPropertyOptional({ type: () => BrandingColorsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingColorsDto)
  colors?: BrandingColorsDto;
}

export class BetaConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional({
    enum: ['sidebar_pill', 'top_banner', 'corner_badge', 'breadcrumb_pill'],
  })
  @IsOptional()
  @IsEnum(['sidebar_pill', 'top_banner', 'corner_badge', 'breadcrumb_pill'])
  style?: string;
}

export class WorkflowConfigDto {
  @ApiPropertyOptional({ description: 'Workflow key from the chapter catalog' })
  @IsString()
  key!: string;

  @ApiPropertyOptional()
  @IsBoolean()
  enabled!: boolean;

  @ApiPropertyOptional({
    description:
      'Optional numeric threshold (guard-parsed; NaN/negative rejected)',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  threshold?: number;
}

export class DuesConfigDto {
  @ApiPropertyOptional({ enum: ['monthly', 'per_semester', 'per_quarter'] })
  @IsOptional()
  @IsEnum(['monthly', 'per_semester', 'per_quarter'])
  cadence?: DuesCadence;

  @ApiPropertyOptional({ description: 'Active member dues in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  active_amount_cents?: number;

  @ApiPropertyOptional({ description: 'New member dues in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  new_member_amount_cents?: number;

  @ApiPropertyOptional({ description: 'Alumni dues in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  alumni_amount_cents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  installments_allowed?: boolean;

  @ApiPropertyOptional({ description: 'Number of installments (>= 1)' })
  @IsOptional()
  @IsInt()
  @Min(1)
  installment_count?: number;

  @ApiPropertyOptional({ description: 'Late fee in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  late_fee_cents?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  grace_days?: number;

  @ApiPropertyOptional({ description: 'Scholarship pool in cents' })
  @IsOptional()
  @IsInt()
  @Min(0)
  scholarship_pool_cents?: number;
}

export class ServiceConfigDto {
  @ApiPropertyOptional({
    description:
      'Minutes of approved service that earn one SERVICE point (default 60). Must be at least 1 — a rate of 0 would divide by zero when awarding.',
    minimum: 1,
    example: 60,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  minutes_per_point?: number;
}

/**
 * Ceiling on the configurable hourly adjustment rate. Not a database
 * constraint — the column only enforces `>= 1` — but an API bound, and it is
 * load-bearing for two reasons. Without an upper bound, `enableImplicitConversion`
 * lets a value like `3000000000` clear `@IsInt()` and then fail the upsert with
 * a raw Postgres `22003 integer out of range`, which `patchConfig` rethrows as
 * a non-HttpException 500 *after* the `chapters` update has already committed
 * and *before* the audit insert runs — a partially-applied config change with
 * no audit row, defeating the "audit trail is a hard requirement" invariant.
 * And short of overflow, an unbounded value simply switches the control off
 * while satisfying every validation layer.
 */
const ADJUSTMENT_RATE_LIMIT_MAX = 1000;

/**
 * Points anti-fraud limits (#394 — `spec/behavior/points.md` § Anti-Fraud).
 *
 * Both floors are `@Min(1)` rather than `@Min(0)`, matching the column CHECKs,
 * and each for its own reason: a rate limit of 0 refuses every adjustment
 * forever (the ledger is append-only, so there is no corrective write back out
 * of that state), and a threshold of 0 flags every row, which makes the Audit
 * tab's flagged filter return the whole ledger and carry no signal.
 *
 * The threshold's ceiling is the ledger's own per-row bound: an adjustment can
 * never exceed ±`POINTS_ADJUSTMENT_MAX`, so a threshold above that could not
 * fire and would be an obscure way to spell "never flag".
 */
export class PointsConfigDto {
  @ApiPropertyOptional({
    description: `Maximum manual point adjustments one admin may create per rolling hour (default 50). Must be between 1 and ${ADJUSTMENT_RATE_LIMIT_MAX} — a limit of 0 would refuse every adjustment with no way back through the API.`,
    minimum: 1,
    maximum: ADJUSTMENT_RATE_LIMIT_MAX,
    example: 50,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(ADJUSTMENT_RATE_LIMIT_MAX)
  adjustment_rate_limit_per_hour?: number;

  @ApiPropertyOptional({
    description: `Absolute point amount at or above which an adjustment is flagged for review (default 100). Must be between 1 and ${POINTS_ADJUSTMENT_MAX} — a threshold of 0 would flag every transaction, and one above the ledger's own ±${POINTS_ADJUSTMENT_MAX} ceiling could never fire.`,
    minimum: 1,
    maximum: POINTS_ADJUSTMENT_MAX,
    example: 100,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(POINTS_ADJUSTMENT_MAX)
  anomaly_threshold?: number;
}

export class PatchChapterConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  org_archetype?: string;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'boolean' },
  })
  @IsOptional()
  @IsObject()
  enabled_modules?: Record<string, boolean>;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'string' },
  })
  @IsOptional()
  @IsObject()
  vocabulary?: Record<string, string>;

  @ApiPropertyOptional({ type: () => BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;

  @ApiPropertyOptional({ type: () => BetaConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BetaConfigDto)
  beta_config?: BetaConfigDto;

  @ApiPropertyOptional({ type: () => DuesConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => DuesConfigDto)
  dues?: DuesConfigDto;

  @ApiPropertyOptional({ type: () => ServiceConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => ServiceConfigDto)
  service?: ServiceConfigDto;

  @ApiPropertyOptional({ type: () => PointsConfigDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => PointsConfigDto)
  points?: PointsConfigDto;

  @ApiPropertyOptional({ type: () => WorkflowConfigDto, isArray: true })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => WorkflowConfigDto)
  workflows?: WorkflowConfigDto[];

  @ApiPropertyOptional({
    description:
      'When true, disables pseudonymous product analytics for this chapter (data-retention.md #analytics-events-pseudonymous).',
  })
  @IsOptional()
  @IsBoolean()
  analytics_opt_out?: boolean;

  /**
   * #422. `null` is an accepted value — it clears the default rather than
   * meaning "unset" — and the property survives `whitelist` either way, so
   * `patchConfig` can still tell "clear it" from "leave it alone".
   *
   * `@ValidateIf` is belt-and-braces rather than load-bearing: `@IsOptional()`
   * alone already skips validation for both `null` and `undefined`. It is kept
   * to state the intent at the point of decision, since the null-is-meaningful
   * contract is the easy thing to break here. A non-null, non-uuid value still
   * fails, which is what matters.
   *
   * Format-validated as a UUID here; that the role exists and belongs to this
   * chapter is checked in the service, which is the only layer that knows the
   * caller's chapter.
   */
  @ApiPropertyOptional({
    type: 'string',
    format: 'uuid',
    nullable: true,
    description:
      'Role id new invites default to when the caller does not name one. Null clears the default, and invites fall back to the seeded Member role. Must belong to this chapter (400 otherwise).',
  })
  @ValidateIf((_object, value) => value !== null)
  @IsOptional()
  @IsUUID()
  default_invite_role_id?: string | null;
}
