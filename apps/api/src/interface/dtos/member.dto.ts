import { IsArray, IsBoolean, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class UpdateMemberRolesDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  role_ids: string[];
}

export class UpdateOnboardingDto {
  @ApiProperty()
  @IsBoolean()
  has_completed_onboarding: boolean;
}
