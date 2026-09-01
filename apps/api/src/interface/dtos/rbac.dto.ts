import {
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ROLE_NAME_MAX_LENGTH } from '@repo/validation';

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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a valid hex color' })
  color?: string;
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

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color must be a valid hex color' })
  color?: string;
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
