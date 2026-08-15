import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ROLE_KEY_MAX_LENGTH,
  ROLE_NAME_MAX_LENGTH,
} from '../../domain/constants/field-limits';

/**
 * A custom role persisted to `chapter_custom_roles` (Settings → Roles → Custom).
 * `key` is a machine-readable slug unique per chapter; `capabilities` are
 * arbitrary permission strings from the catalog. `core` is intentionally NOT
 * client-settable — only system seeding marks a role core (core roles cannot be
 * deleted), so user-created roles are always non-core and remain deletable.
 */
export class CreateCustomRoleDto {
  @ApiProperty({
    description: 'Machine-readable slug, unique per chapter',
    maxLength: ROLE_KEY_MAX_LENGTH,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROLE_KEY_MAX_LENGTH)
  @Matches(/^[a-z0-9_]+$/, {
    message: 'key must be lowercase letters, numbers, and underscores',
  })
  key: string;

  @ApiProperty({ maxLength: ROLE_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROLE_NAME_MAX_LENGTH)
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
}

export class UpdateCustomRoleDto {
  @ApiPropertyOptional({ maxLength: ROLE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROLE_NAME_MAX_LENGTH)
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

/** Response shape for a `chapter_custom_roles` row (for OpenAPI/SDK typing). */
export class CustomRoleDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chapter_id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  label: string;

  @ApiProperty()
  rank: number;

  @ApiProperty({ type: [String] })
  capabilities: string[];

  @ApiProperty()
  core: boolean;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}

/** Response for `DELETE /custom-roles/:id`. */
export class RemoveCustomRoleResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
}
