import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';

export class BrandingColorsDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  dark?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
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

export class DuesConfigDto {
  @ApiPropertyOptional({ enum: ['semester', 'monthly', 'annual'] })
  @IsOptional()
  @IsEnum(['semester', 'monthly', 'annual'])
  cadence?: string;

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
}
