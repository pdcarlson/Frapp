import {
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { OPS_NUDGE_MODULES } from '@repo/validation';

export class UpdateMemberRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  role_ids: string[];

  @ApiPropertyOptional({
    type: [String],
    description:
      'Assigned chapter_custom_roles ids. Omit to leave custom-role assignment unchanged; an empty array clears it.',
  })
  @IsOptional()
  @IsArray()
  // UUID-validated (unlike role_ids, which is validated in memory against the
  // chapter's roles): a malformed id would otherwise hit the uuid PK filter
  // and surface as a 500 instead of a 400.
  @IsUUID(undefined, { each: true })
  custom_role_ids?: string[];
}

export class UpdateOnboardingDto {
  @ApiProperty()
  @IsBoolean()
  has_completed_onboarding: boolean;
}

export class DismissOpsNudgeDto {
  @ApiProperty({
    enum: OPS_NUDGE_MODULES.map((m) => m.key),
    description:
      'Module whose ops-setup nudge to dismiss for the caller in the active chapter. Validated against the shared catalog rather than accepted as free text: `members.dismissed_ops_nudges` is an unconstrained `text[]`, so an unchecked value would persist forever and suppress nothing.',
  })
  @IsString()
  @IsIn(OPS_NUDGE_MODULES.map((m) => m.key))
  module_key: string;
}
