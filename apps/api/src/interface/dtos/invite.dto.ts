import {
  IsString,
  IsInt,
  IsOptional,
  Min,
  Max,
  IsEmail,
  ArrayMinSize,
  ArrayMaxSize,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * #422: `role` is optional on all three create routes. Omitting it falls back
 * to the chapter's configured `default_invite_role_id`, then to the seeded
 * Member role — so a caller that never learned about roles still issues a
 * sensible invite, and a chapter that set a default does not have to restate
 * it on every call. Naming a role still wins, so no existing caller changes
 * behaviour.
 */
const ROLE_DESCRIPTION =
  "Role name to assign. Omit to use the chapter's configured default invite role.";

export class CreateInviteDto {
  @ApiPropertyOptional({ description: ROLE_DESCRIPTION })
  @IsOptional()
  @IsString()
  role?: string;
}

export class BatchCreateInvitesDto {
  @ApiPropertyOptional({ description: ROLE_DESCRIPTION })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({ description: 'Number of invites to generate' })
  @IsInt()
  @Min(1)
  @Max(50)
  count: number;
}

export class BulkEmailInviteDto {
  @ApiPropertyOptional({ description: ROLE_DESCRIPTION })
  @IsOptional()
  @IsString()
  role?: string;

  @ApiProperty({
    description: 'Email addresses to invite, one invite token per address',
    type: [String],
  })
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsEmail({}, { each: true })
  emails: string[];
}

export class RedeemInviteDto {
  @ApiProperty()
  @IsString()
  token: string;
}
