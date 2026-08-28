import {
  Equals,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { BrandingDto } from './chapter-config.dto';

/**
 * Payload for the onboarding wizard (Chunk 03). The wizard collects chapter
 * identity (from the directory autofill or manual entry) and the chosen
 * archetype; the server materializes the full config from the archetype seed
 * (enabled_modules, vocabulary, theme palette) so the client can't smuggle an
 * arbitrary module map. Actor identity comes from the session, not this DTO.
 */
export class ChapterOnboardingDto {
  @ApiProperty({ description: 'Chapter display name (org name)' })
  @IsString()
  @MinLength(3)
  name: string;

  @ApiProperty({ description: 'University / institution name' })
  @IsString()
  @MinLength(2)
  university: string;

  @ApiPropertyOptional({
    description: 'Org archetype key (ifc, npc, nphc, mgc, …). Defaults to ifc.',
  })
  @IsOptional()
  @IsString()
  org_archetype?: string;

  @ApiPropertyOptional({
    description: 'chapter_directory row id when the chapter was matched',
  })
  @IsOptional()
  @IsUUID()
  directory_id?: string;

  @ApiPropertyOptional({ type: () => BrandingDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => BrandingDto)
  branding?: BrandingDto;

  @ApiProperty({
    description:
      'The admin accepted the Terms of Service and Privacy Policy. Must be ' +
      'true (spec/behavior/legal.md). The acceptance timestamp and policy ' +
      'version are recorded server-side from the session — never from this payload.',
  })
  @IsBoolean()
  @Equals(true, {
    message: 'Terms of Service and Privacy Policy must be accepted',
  })
  accept_terms_privacy: boolean;
}
