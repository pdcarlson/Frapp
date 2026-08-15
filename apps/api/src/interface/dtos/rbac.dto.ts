import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Role names are chapter-authored labels rendered in member lists and the role
 * picker. The cap keeps an unbounded string out of the column and out of every
 * surface that renders it; it is far above any real role name.
 */
const ROLE_NAME_MAX_LENGTH = 100;

export class CreateRoleDto {
  @ApiProperty({ maxLength: ROLE_NAME_MAX_LENGTH })
  @IsString()
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
