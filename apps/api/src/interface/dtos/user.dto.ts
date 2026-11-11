import {
  Equals,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  ValidateIf,
  Matches,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  GRADUATION_YEAR_MAX,
  GRADUATION_YEAR_MIN,
  LEGAL_ACCEPTANCE_LABEL,
  MAJOR_MAX_LENGTH,
  RELEASE_NOTE_VERSION_PATTERN,
} from '@repo/validation';

export class MyPermissionsDto {
  @ApiProperty({
    type: [String],
    description:
      "Caller's effective permission set for the active chapter. Contains the wildcard `*` for Presidents. Empty array means no active roles.",
    example: ['members:view', 'events:create'],
  })
  permissions: string[];
}

/**
 * Where the caller stands against the Terms the server enforces now (#2302).
 * Clients show the acceptance prompt when `required` is true and never compare
 * versions themselves; `LegalAcceptanceService` explains why.
 */
export class LegalAcceptanceDto {
  @ApiProperty({
    description: 'The Terms and Privacy Policy version this server enforces.',
    example: '2026-09',
  })
  current_version: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The version the caller last accepted. Null if they never have.',
  })
  accepted_version: string | null;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'When the caller accepted `accepted_version`.',
  })
  accepted_at: string | null;

  @ApiProperty({
    description:
      'True until the caller accepts `current_version`. While it is true, clients ask before anything else, and joining a chapter needs `accept_terms_privacy`.',
  })
  required: boolean;
}

export class AcceptLegalTermsDto {
  @ApiProperty({
    description: `The user ticked "${LEGAL_ACCEPTANCE_LABEL}" Must be true. The timestamp and version are recorded server-side, never from this payload.`,
  })
  @IsStrictBoolean()
  @Equals(true, {
    message: 'Terms of Service and Privacy Policy must be accepted',
  })
  accept_terms_privacy: boolean;
}

/**
 * The newest What's new entry any of the caller's devices has shown (#4043).
 * A device that would open What's new by itself checks this first: when the
 * account has seen the newest entry, it shows a mark on its What's new entry
 * instead of opening the notes again.
 */
export class WhatsNewSeenDto {
  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "A `releaseNoteVersion` (`YYYY-MM-DD#lines`): the newest entry's date and how many lines it had. Null until one of the caller's devices records one.",
    example: '2026-11-10#6',
  })
  seen_version: string | null;
}

export class RecordWhatsNewSeenDto {
  @ApiProperty({
    description:
      'The `releaseNoteVersion` of the newest entry the device just showed. The account keeps the later of this and what it already holds, so an older build never lowers it.',
    example: '2026-11-10#6',
  })
  @IsString()
  @Matches(RELEASE_NOTE_VERSION_PATTERN, {
    message: 'seen_version must look like YYYY-MM-DD#lines',
  })
  seen_version: string;
}

export class RequestAvatarUploadUrlDto {
  @ApiProperty({ description: 'Original filename for the avatar image' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({
    description: 'MIME content type (e.g. image/jpeg, image/png)',
  })
  @IsString()
  @MaxLength(255)
  content_type: string;

  @ApiPropertyOptional({
    description:
      'File size in bytes, if known. Rejected server-side against the upload size ceiling when present.',
  })
  // Omitted is "size unknown"; `null` is not a size. `@IsOptional` would
  // let it through to the ceiling check, which then called it too large (#2913).
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  size_bytes?: number;
}

export class AvatarUploadUrlResponseDto {
  @ApiProperty({
    description: 'Short-lived signed URL; PUT the bytes to it.',
  })
  upload_url: string;

  @ApiProperty({
    description:
      'Storage path to send back on `POST /v1/users/me/avatar` once the PUT succeeds.',
  })
  storage_path: string;
}

export class ConfirmAvatarDto {
  @ApiProperty({
    description: 'Storage path returned from `POST /v1/users/me/avatar-url`',
  })
  @IsString()
  @MaxLength(1024)
  storage_path: string;
}

/**
 * `avatar_url` is deliberately absent (#2519): the photo is set only by
 * confirming an upload (`POST /v1/users/me/avatar`), which checks the path is
 * the caller's own object, and cleared by `DELETE /v1/users/me/avatar`.
 */
export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsInt()
  @Min(GRADUATION_YEAR_MIN)
  @Max(GRADUATION_YEAR_MAX)
  graduation_year?: number | null;

  @ApiPropertyOptional({
    description:
      'Free text, like "Mechanical Engineering". An empty string clears it.',
    maxLength: MAJOR_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MaxLength(MAJOR_MAX_LENGTH)
  major?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  current_city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  current_company?: string;
}
