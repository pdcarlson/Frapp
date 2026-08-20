import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import type { DuesCadence } from '../../domain/entities/chapter-dues-config.entity';

/** Matches the `accent_color` column's own validation in `chapter.dto.ts`. */
const HEX_COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/;

/**
 * Both fields are format-validated but NOT contrast-gated — they are the accent
 * engine's inputs, and the raw seed never paints UI. Reasoning and the measured
 * impact of gating them: `spec/behavior/branding.md`.
 *
 * The format check is not cosmetic. These were bare `@IsString()`, so a value
 * like `"crimson"` reached `derivePalette`, which silently substituted bronze —
 * the #840 failure mode, where 50 seed rows missing a leading `#` all became
 * platform bronze with nothing recording it.
 */
export class BrandingColorsDto {
  @ApiPropertyOptional({
    example: '#4B2E2E',
    pattern: HEX_COLOR_PATTERN.source,
  })
  @IsOptional()
  @IsString()
  @Matches(HEX_COLOR_PATTERN, { message: 'dark must be a hex color (#RRGGBB)' })
  dark?: string;

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
}
