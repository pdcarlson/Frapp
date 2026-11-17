import {
  Equals,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  CHAPTER_NAME_MAX_LENGTH,
  CHAPTER_NAME_MIN_LENGTH,
  CHAPTER_UNIVERSITY_MAX_LENGTH,
  CHAPTER_UNIVERSITY_MIN_LENGTH,
} from '@repo/validation';
import { BrandingDto } from './chapter-config.dto';
import {
  ChapterNameRules,
  ChapterUniversityRules,
} from '../decorators/chapter-identity.decorator';

/**
 * Payload for the onboarding wizard (Chunk 03). The wizard collects chapter
 * identity (from the directory autofill or manual entry) and the chosen
 * archetype; the server materializes the full config from the archetype seed
 * (enabled_modules, vocabulary, theme palette) so the client can't smuggle an
 * arbitrary module map. Actor identity comes from the session, not this DTO.
 */
export class ChapterOnboardingDto {
  // The Settings save's rule too (`UpdateChapterDto`). Both wizards trim
  // before sending already.
  @ApiProperty({
    description: `Chapter display name (org name). Trimmed; at least ${CHAPTER_NAME_MIN_LENGTH} characters.`,
    maxLength: CHAPTER_NAME_MAX_LENGTH,
  })
  @ChapterNameRules()
  name: string;

  @ApiProperty({
    description: `University / institution name. Trimmed; at least ${CHAPTER_UNIVERSITY_MIN_LENGTH} characters.`,
    maxLength: CHAPTER_UNIVERSITY_MAX_LENGTH,
  })
  @ChapterUniversityRules()
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
      'The admin accepted the Terms of Service and Privacy Policy, for the ' +
      'chapter and for themselves. Must be true (spec/behavior/legal.md). The ' +
      'acceptance timestamp and policy version are recorded server-side from ' +
      'the session — never from this payload.',
  })
  @IsStrictBoolean()
  @Equals(true, {
    message: 'Terms of Service and Privacy Policy must be accepted',
  })
  accept_terms_privacy: boolean;
}
