import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

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
