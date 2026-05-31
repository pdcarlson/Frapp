import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A custom role persisted to `chapter_custom_roles` (Settings → Roles → Custom).
 * `key` is a machine-readable slug unique per chapter; `capabilities` are
 * arbitrary permission strings from the catalog. `core` roles cannot be deleted.
 */
export class CreateCustomRoleDto {
  @ApiProperty({ description: 'Machine-readable slug, unique per chapter' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z0-9_]+$/, {
    message: 'key must be lowercase letters, numbers, and underscores',
  })
  key: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  label: string;

  @ApiPropertyOptional({ description: 'Hierarchy order; lower ranks first' })
  @IsOptional()
  @IsInt()
  @Min(0)
  rank?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @ApiPropertyOptional({
    description: 'Core roles are protected from deletion',
  })
  @IsOptional()
  @IsBoolean()
  core?: boolean;
}

export class UpdateCustomRoleDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  rank?: number;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];
}
