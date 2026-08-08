import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Rejects a `quiet_hours_tz` the runtime cannot resolve. The stored value is fed
 * straight to `Intl.DateTimeFormat` during push delivery, so an unknown zone
 * written here used to cost that member every notification — push and in-app row
 * alike — until someone edited the field. `@MaxLength` alone never caught it.
 *
 * Fails open when the runtime cannot resolve even `UTC`, so an ICU build without
 * zone data rejects nothing rather than everything. Mirrors the client-side probe
 * in `apps/mobile/app/(tabs)/preferences.tsx`.
 */
@ValidatorConstraint({ name: 'supportedTimeZone', async: false })
export class SupportedTimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (value === undefined || value === null) return true;
    if (typeof value !== 'string') return false;

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: 'UTC' });
    } catch {
      return true;
    }

    try {
      new Intl.DateTimeFormat('en-US', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }

  defaultMessage(): string {
    return 'quiet_hours_tz must be a valid IANA time zone (e.g. America/New_York)';
  }
}

export class RegisterPushTokenDto {
  @ApiProperty({ description: 'Expo push token' })
  @IsString()
  token: string;

  @ApiPropertyOptional({ description: 'Device name for display' })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  device_name?: string;
}

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ description: 'Chapter ID' })
  @IsUUID()
  chapter_id: string;

  @ApiProperty({ description: 'Notification category (e.g. chat, events)' })
  @IsString()
  @MaxLength(100)
  category: string;

  @ApiProperty({
    description: 'Whether notifications for this category are enabled',
  })
  @IsBoolean()
  is_enabled: boolean;
}

export class UpdateUserSettingsDto {
  @ApiPropertyOptional({
    description:
      'Quiet hours start (HH:mm format, e.g. 22:00). Pass null to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, {
    message: 'quiet_hours_start must be in HH:mm or HH:mm:ss format',
  })
  quiet_hours_start?: string | null;

  @ApiPropertyOptional({
    description:
      'Quiet hours end (HH:mm format, e.g. 08:00). Pass null to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, {
    message: 'quiet_hours_end must be in HH:mm or HH:mm:ss format',
  })
  quiet_hours_end?: string | null;

  @ApiPropertyOptional({
    description:
      'IANA timezone for quiet hours (e.g. America/New_York). Must be a zone the server can resolve. Pass null to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(100)
  @Validate(SupportedTimeZoneConstraint)
  quiet_hours_tz?: string | null;

  @ApiPropertyOptional({
    description: 'Theme preference',
    enum: ['light', 'dark', 'system'],
  })
  @IsOptional()
  @IsString()
  @Matches(/^(light|dark|system)$/, {
    message: 'theme must be light, dark, or system',
  })
  theme?: 'light' | 'dark' | 'system';
}
