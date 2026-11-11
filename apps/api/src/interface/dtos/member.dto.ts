import { IsArray, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MEMBER_DISMISSAL_KEYS } from '@repo/validation';

export class UpdateMemberRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  role_ids: string[];

  @ApiPropertyOptional({
    type: [String],
    deprecated: true,
    description:
      'Deprecated. Custom roles were folded into ordinary roles (#4075); assign them through role_ids. Still accepted, as [], so a web page loaded before that deploy can save; a non-empty list means the page read the member before the fold, so its role_ids would drop the folded roles, and the save is refused with 409.',
  })
  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  custom_role_ids?: string[];
}

export class UpdateOnboardingDto {
  @ApiProperty()
  @IsStrictBoolean()
  has_completed_onboarding: boolean;
}

export class DismissOpsNudgeDto {
  @ApiProperty({
    enum: [...MEMBER_DISMISSAL_KEYS],
    description:
      'Module whose ops-setup nudge to dismiss for the caller in the active chapter, or `setup-checklist` for the officer setup checklist on chat home. Validated against the shared catalog rather than accepted as free text: `members.dismissed_ops_nudges` is an unconstrained `text[]`, so an unchecked value would persist forever and suppress nothing.',
  })
  @IsString()
  @IsIn([...MEMBER_DISMISSAL_KEYS])
  module_key: string;
}
