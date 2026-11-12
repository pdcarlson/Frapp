import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  PERMISSION_MODULES,
  ROLE_COLOR_HEXES,
  ROLE_NAME_MAX_LENGTH,
  type PermissionModuleKey,
  type PermissionScope,
} from '@repo/validation';
import {
  POSITION_MAX,
  ROLE_TIER_POSITION_MAX,
} from '#domain/constants/field-limits';

/** `role_tiers_name_len` (migration `20261111140000`). */
const ROLE_TIER_NAME_MAX_LENGTH = 80;
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';

/**
 * Upper-cases a role color string before `@IsIn` checks it, so `#f2994a` is
 * the palette's `#F2994A` and is stored in the palette's spelling (#3485).
 * Anything else passes through for the validators to judge.
 */
function normalizeRoleColorInput(value: unknown): unknown {
  return typeof value === 'string' ? value.trim().toUpperCase() : value;
}

export class CreateRoleDto {
  @ApiProperty({ maxLength: ROLE_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROLE_NAME_MAX_LENGTH)
  name: string;

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  permissions: string[];

  @ApiPropertyOptional({ maximum: POSITION_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  display_order?: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: ROLE_COLOR_HEXES,
    description:
      'One of the role palette colors (`ROLE_COLOR_PALETTE` in `@repo/validation`), in any letter case; it is stored as listed. Null clears the color.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeRoleColorInput(value))
  @IsIn(ROLE_COLOR_HEXES, {
    message: 'color must be one of the role palette colors',
  })
  color?: string | null;
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Whether any member may `@` this role in chat. Defaults to true. While false, only a member holding `channels:manage` or `roles:manage` (or the wildcard) can ping it.',
  })
  @IsOptional()
  @IsStrictBoolean()
  mentionable?: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "The tier the role sits in (#4071), one ranked below the caller's own; null puts it outside the tiers. A role takes its tier's permissions, with its own overrides applied.",
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  tier_id?: string | null;
}

export class UpdateRoleDto {
  @ApiPropertyOptional({ maxLength: ROLE_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @MaxLength(ROLE_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];

  @ApiPropertyOptional({ maximum: POSITION_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  display_order?: number;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    enum: ROLE_COLOR_HEXES,
    description:
      'One of the role palette colors (`ROLE_COLOR_PALETTE` in `@repo/validation`), in any letter case; it is stored as listed. Null clears the color.',
  })
  @IsOptional()
  @Transform(({ value }) => normalizeRoleColorInput(value))
  @IsIn(ROLE_COLOR_HEXES, {
    message: 'color must be one of the role palette colors',
  })
  color?: string | null;
  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Whether any member may `@` this role in chat. Defaults to true. While false, only a member holding `channels:manage` or `roles:manage` (or the wildcard) can ping it.',
  })
  @IsOptional()
  @IsStrictBoolean()
  mentionable?: boolean;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "The tier the role sits in (#4071), one ranked below the caller's own; null puts it outside the tiers. A role takes its tier's permissions, with its own overrides applied.",
  })
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsUUID()
  tier_id?: string | null;

  @ApiPropertyOptional({
    type: 'object',
    additionalProperties: { type: 'boolean', nullable: true },
    description:
      'Overrides to change, merged into what the role has (#4071): true switches a permission on for this role whatever its tier says, false switches it off, null clears the override so the tier decides. Keys left out are kept. Not with `permissions`.',
    example: { 'service:approve': true, 'polls:create': null },
  })
  @IsOptional()
  @IsObject()
  permission_overrides?: Record<string, boolean | null>;
}

export class TransferPresidencyDto {
  // Reaches the transfer_presidency RPC as a uuid argument; an unvalidated
  // string fails inside Postgres rather than at the edge.
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  target_member_id: string;
}

/** Response shape of `GET /v1/roles/presidency-claim-status` (#349). */
export class PresidencyClaimStatusDto {
  @ApiProperty({
    description: 'Whether the chapter currently has no President.',
  })
  needs_president: boolean;

  @ApiProperty({
    description:
      "Whether the caller holds the chapter's next-highest-ranked role with a live member, and may call POST /v1/roles/claim-presidency right now.",
  })
  eligible: boolean;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Name of the eligible role, or null when no role below President has any member at all (the "Frapp support intervenes" case).',
  })
  next_role_name: string | null;
}

/** One row of `GET /v1/roles/permissions-catalog` (#4069). */
export class PermissionCatalogEntryDto {
  @ApiProperty({
    description: "The API constant's name, e.g. `EVENTS_CREATE`.",
  })
  key: string;

  @ApiProperty({
    description: 'The string a role stores, e.g. `events:create`.',
  })
  permission: string;

  @ApiProperty({
    enum: PERMISSION_MODULES.map((module) => module.key),
    description:
      'The module the permission belongs to: a module catalog key, or `chapter` for a chapter-level permission.',
  })
  module: PermissionModuleKey;

  @ApiProperty({ description: "The module's display name." })
  module_label: string;

  @ApiProperty({ description: 'What the permission lets a role do.' })
  label: string;

  @ApiProperty({ description: 'One line on what granting it opens.' })
  description: string;

  @ApiProperty({
    enum: ['chapter'],
    description: 'The level the permission applies at. Always `chapter` today.',
  })
  scope: PermissionScope;
}

export class CreateRoleTierDto {
  @ApiProperty({ maxLength: ROLE_TIER_NAME_MAX_LENGTH })
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROLE_TIER_NAME_MAX_LENGTH)
  name: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      'What every role in the tier gets. Only permissions the caller holds; never `*`. Defaults to none.',
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class UpdateRoleTierDto {
  @ApiPropertyOptional({ maxLength: ROLE_TIER_NAME_MAX_LENGTH })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(ROLE_TIER_NAME_MAX_LENGTH)
  name?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      "The tier's whole list; every role in it is rewritten to match, with its own overrides applied. Never `*`.",
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  permissions?: string[];
}

export class ReorderRoleTiersDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      "Every one of the chapter's tiers, highest first. Tiers ranked at or above the caller's own must stay where they are.",
  })
  @IsArray()
  @ArrayMaxSize(ROLE_TIER_POSITION_MAX)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  tier_ids: string[];
}

/** One of a chapter's tiers (`GET /v1/role-tiers`, #4071). */
export class RoleTierDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({ description: 'Order within the chapter; 1 is highest.' })
  position: number;

  @ApiProperty({ description: "The chapter's own name for the tier." })
  name: string;

  @ApiProperty({
    type: [String],
    description: 'What every role in the tier gets before its own overrides.',
  })
  permissions: string[];

  @ApiProperty()
  created_at: string;

  @ApiProperty()
  updated_at: string;
}
