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
  ValidateIf,
} from 'class-validator';
import { Transform } from 'class-transformer';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GRADUATION_YEAR_MAX,
  GRADUATION_YEAR_MIN,
  MEMBER_DISMISSAL_KEYS,
} from '@repo/validation';

/**
 * An officer's fix to another member's profile (#4367,
 * `PATCH /v1/members/{id}/profile`): their name and graduation year only. The
 * rest of a profile is the member's own (`spec/behavior/members.md`
 * § Officer corrections).
 */
export class CorrectMemberProfileDto {
  @ApiPropertyOptional({
    description:
      "The member's name as the chapter knows them. Trimmed; it may not be blank.",
    maxLength: 100,
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty({ message: 'Enter a name.' })
  @MaxLength(100)
  display_name?: string;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: "The member's graduation year, or null to clear it.",
  })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsInt()
  @Min(GRADUATION_YEAR_MIN)
  @Max(GRADUATION_YEAR_MAX)
  graduation_year?: number | null;
}

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
