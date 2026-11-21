import {
  IsString,
  IsOptional,
  IsUrl,
  Matches,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAPTER_NAME_MAX_LENGTH,
  CHAPTER_NAME_MIN_LENGTH,
  CHAPTER_UNIVERSITY_MAX_LENGTH,
  CHAPTER_UNIVERSITY_MIN_LENGTH,
} from '@repo/validation';
import {
  ChapterNameRules,
  ChapterUniversityRules,
} from '../decorators/chapter-identity.decorator';

export class LogoUploadUrlDto {
  @ApiProperty({ description: 'Original filename (e.g. logo.png)' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. image/png)' })
  @IsString()
  content_type: string;
}

export class LogoUploadUrlResponseDto {
  @ApiProperty({
    description: 'Short-lived signed URL; PUT the bytes to it.',
  })
  upload_url: string;

  @ApiProperty({
    description: 'Storage path to send back on the confirm-logo call.',
  })
  storage_path: string;
}

export class ConfirmLogoDto {
  @ApiProperty({ description: 'Storage path returned from logo-url' })
  @IsString()
  storage_path: string;
}

export class UpdateChapterDto {
  // The onboarding wizard's rule (`ChapterOnboardingDto`), so a name one route
  // takes the other takes too. Settings sends only a field the officer
  // changed, so a name stored before the rule never refuses an unrelated save.
  @ApiPropertyOptional({
    description: `The chapter's name. Trimmed; at least ${CHAPTER_NAME_MIN_LENGTH} characters. Omit it to leave it as stored.`,
    maxLength: CHAPTER_NAME_MAX_LENGTH,
  })
  // Not `@IsOptional`, which would also skip the checks for `null` and let it
  // reach the NOT NULL column as a 500: only an absent name is skipped.
  @ValidateIf((_obj, value) => value !== undefined)
  @ChapterNameRules()
  name?: string;

  @ApiPropertyOptional({
    description: `The chapter's university. Trimmed; at least ${CHAPTER_UNIVERSITY_MIN_LENGTH} characters. Omit it to leave it as stored.`,
    maxLength: CHAPTER_UNIVERSITY_MAX_LENGTH,
  })
  @ValidateIf((_obj, value) => value !== undefined)
  @ChapterUniversityRules()
  university?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @Matches(/^#[0-9A-Fa-f]{6}$/, {
    message: 'accent_color must be a valid hex color',
  })
  accent_color?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUrl()
  donation_url?: string;
}
