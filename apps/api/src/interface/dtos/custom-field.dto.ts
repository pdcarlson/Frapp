import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

const FIELD_TYPES = [
  'text',
  'number',
  'decimal',
  'phone',
  'select',
  'boolean',
] as const;
const FIELD_VISIBILITIES = ['self', 'chapter', 'exec', 'president'] as const;

/**
 * Type-specific configuration carried in the `options` jsonb column. `choices`
 * holds a `select` field's option list; `max_length` is an optional cap for
 * `text`. The precise per-type shape is enforced by the shared zod schema
 * (`@repo/validation`); this DTO does coarse structural validation.
 */
export class CustomFieldOptionsDto {
  @ApiPropertyOptional({
    type: [String],
    description: 'Option list for select',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  choices?: string[];

  @ApiPropertyOptional({ description: 'Max length for text fields' })
  @IsOptional()
  @IsInt()
  @Min(1)
  max_length?: number;
}

/**
 * A custom member field persisted to `chapter_custom_fields` (Settings →
 * Fields). `key` is a machine-readable slug unique per chapter; `type` and
 * `key` are immutable after creation (changing `type` would orphan stored
 * member values). Unlike custom roles there is no `core` flag — every field is
 * deletable.
 */
export class CreateCustomFieldDto {
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

  @ApiProperty({ enum: FIELD_TYPES })
  @IsIn(FIELD_TYPES)
  type: (typeof FIELD_TYPES)[number];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ enum: FIELD_VISIBILITIES, default: 'chapter' })
  @IsOptional()
  @IsIn(FIELD_VISIBILITIES)
  visibility?: (typeof FIELD_VISIBILITIES)[number];

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;

  @ApiPropertyOptional({ type: () => CustomFieldOptionsDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomFieldOptionsDto)
  options?: CustomFieldOptionsDto;

  @ApiPropertyOptional({ description: 'Display order; lower sorts first' })
  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

/** Body for `PATCH /custom-fields/:id` (`key` and `type` are immutable). */
export class UpdateCustomFieldDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  label?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  @ApiPropertyOptional({ enum: FIELD_VISIBILITIES })
  @IsOptional()
  @IsIn(FIELD_VISIBILITIES)
  visibility?: (typeof FIELD_VISIBILITIES)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  sensitive?: boolean;

  @ApiPropertyOptional({ type: () => CustomFieldOptionsDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => CustomFieldOptionsDto)
  options?: CustomFieldOptionsDto | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  sort?: number;
}

/** Response shape for a `chapter_custom_fields` row (for OpenAPI/SDK typing). */
export class CustomFieldDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  chapter_id: string;

  @ApiProperty()
  key: string;

  @ApiProperty()
  label: string;

  @ApiProperty({ enum: FIELD_TYPES })
  type: (typeof FIELD_TYPES)[number];

  @ApiProperty()
  required: boolean;

  @ApiProperty({ enum: FIELD_VISIBILITIES })
  visibility: (typeof FIELD_VISIBILITIES)[number];

  @ApiProperty()
  sensitive: boolean;

  @ApiPropertyOptional({ type: () => CustomFieldOptionsDto, nullable: true })
  options: CustomFieldOptionsDto | null;

  @ApiProperty()
  sort: number;

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}

/** Response for `DELETE /custom-fields/:id`. */
export class RemoveCustomFieldResponseDto {
  @ApiProperty({ example: true })
  success: boolean;
}
