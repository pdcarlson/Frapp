import {
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLE_COLOR_HEXES, ROLE_NAME_MAX_LENGTH } from '@repo/validation';
import { POSITION_MAX } from '#domain/constants/field-limits';
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
