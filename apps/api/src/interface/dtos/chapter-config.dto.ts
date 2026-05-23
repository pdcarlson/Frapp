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
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
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
  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;

  @ApiProperty({
    enum: ['sidebar_pill', 'top_banner', 'corner_badge', 'breadcrumb_pill'],
  })
  @IsEnum(['sidebar_pill', 'top_banner', 'corner_badge', 'breadcrumb_pill'])
  style!: string;
}

export class DuesConfigDto {
  @ApiProperty({ enum: ['semester', 'monthly', 'annual'] })
  @IsEnum(['semester', 'monthly', 'annual'])
  cadence!: string;

  @ApiProperty({ description: 'Active member dues in cents' })
  @IsInt()
  @Min(0)
  active_amount_cents!: number;

  @ApiProperty({ description: 'New member dues in cents' })
  @IsInt()
  @Min(0)
  new_member_amount_cents!: number;

  @ApiProperty({ description: 'Alumni dues in cents' })
  @IsInt()
  @Min(0)
  alumni_amount_cents!: number;

  @ApiProperty()
  @IsBoolean()
  installments_allowed!: boolean;

  @ApiProperty({ description: 'Late fee in cents' })
  @IsInt()
  @Min(0)
  late_fee_cents!: number;

  @ApiProperty()
  @IsInt()
  @Min(0)
  grace_days!: number;

  @ApiProperty({ description: 'Scholarship pool in cents' })
  @IsInt()
  @Min(0)
  scholarship_pool_cents!: number;
}

export class PatchChapterConfigDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  org_archetype?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsObject()
  enabled_modules?: Record<string, boolean>;

  @ApiPropertyOptional()
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
