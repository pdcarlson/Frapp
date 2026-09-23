import {
  Equals,
  IsBoolean,
  IsOptional,
  IsString,
  IsInt,
  Min,
  Max,
  MaxLength,
  ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { RawValue } from './raw-value.transform';
import { LEGAL_ACCEPTANCE_LABEL } from '@repo/validation';

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
  @RawValue()
  @IsBoolean()
  @Equals(true, {
    message: 'Terms of Service and Privacy Policy must be accepted',
  })
  accept_terms_privacy: boolean;
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
  content_type: string;
}

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  display_name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  bio?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  avatar_url?: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @ValidateIf((_obj, value) => value !== null)
  @IsInt()
  @Min(1900)
  @Max(2100)
  graduation_year?: number | null;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  current_city?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  current_company?: string;
}
