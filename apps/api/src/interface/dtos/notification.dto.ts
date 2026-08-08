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
import { Transform } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { isSupportedTimeZone, MAX_TIME_ZONE_LENGTH } from '@repo/validation';

/**
 * Rejects a `quiet_hours_tz` this system will not accept. The stored value is fed
 * to `Intl.DateTimeFormat` during push delivery, so an unknown zone written here
 * used to cost that member every notification — push and in-app row alike —
 * until someone edited the field. `@MaxLength` alone never caught it.
 *
 * The rule itself lives in `@repo/validation` because the web panel and the
 * mobile preferences screen have to agree with the server about which zones are
 * acceptable: a client that submits what the server rejects produces a save that
 * fails with no field-level explanation, which is how unresolvable zones reached
 * stored rows to begin with.
 */
@ValidatorConstraint({ name: 'supportedTimeZone', async: false })
export class SupportedTimeZoneConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    // `null` clears the field, and the @Transform below has already turned blank
    // input into `null` — so any string reaching here is a real candidate zone.
    if (value === undefined || value === null) return true;
    return isSupportedTimeZone(value);
  }

  defaultMessage(): string {
    return 'quiet_hours_tz must be a time zone the server can resolve (e.g. America/New_York)';
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
      'Time zone for quiet hours — must be one the server can resolve (e.g. America/New_York). Prefer a named zone: a fixed offset such as -05:00 is accepted but does not follow daylight saving time. Pass null or an empty string to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  // A cleared input is a clear, not a validation error. The web panel binds this
  // field to `""`, so rejecting blank would leave a member who has a bad stored
  // zone unable to turn quiet hours off — the one escape hatch they need.
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length === 0 ? null : value,
  )
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @MaxLength(MAX_TIME_ZONE_LENGTH)
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
