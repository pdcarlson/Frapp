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
 * Trims a string field and maps a now-empty one to `null`.
 *
 * Both clients bind these inputs to `""` rather than removing the key, so a
 * cleared field arrives as an empty string. Treating that as a validation error
 * rejects the whole payload and takes the member's unrelated edits with it —
 * and, for someone whose stored value is already unusable, removes the only way
 * to switch quiet hours off.
 */
function normalizeBlankToNull(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Rejects a `quiet_hours_tz` this system will not accept. The stored value is fed
 * to `Intl.DateTimeFormat` during push delivery, so an unknown zone written here
 * used to cost that member every notification — push and in-app row alike —
 * until someone edited the field. `@MaxLength` alone never caught it.
 *
 * The rule itself lives in `@repo/validation` so the clients can show a
 * field-level message instead of surfacing a bare 400. This server-side check is
 * the authority, though: a client's `Intl` may know fewer zones than the
 * server's, so clients must never treat their own verdict as final.
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
      'Quiet hours start (HH:mm format, e.g. 22:00). Pass null or an empty string to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeBlankToNull(value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, {
    message: 'quiet_hours_start must be in HH:mm or HH:mm:ss format',
  })
  quiet_hours_start?: string | null;

  @ApiPropertyOptional({
    description:
      'Quiet hours end (HH:mm format, e.g. 08:00). Pass null or an empty string to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeBlankToNull(value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(/^\d{2}:\d{2}(:\d{2})?$/, {
    message: 'quiet_hours_end must be in HH:mm or HH:mm:ss format',
  })
  quiet_hours_end?: string | null;

  @ApiPropertyOptional({
    description:
      'Time zone for quiet hours — must be a named zone this server can resolve (e.g. America/New_York). A fixed offset such as -05:00 is not portable and is rejected on the deployment runtime. Pass null or an empty string to clear.',
    nullable: true,
    type: String,
  })
  @IsOptional()
  // Trim before anything else sees the value: validation probes the trimmed
  // form, so storing the raw one would let `"America/New_York "` pass here and
  // then throw at delivery — the unusable stored row this validation exists to
  // prevent. Blank then falls out as `null`, which is a clear, not an error:
  // the web panel binds this field to `""`, so rejecting blank would leave a
  // member holding a bad zone unable to turn quiet hours off.
  @Transform(({ value }) => normalizeBlankToNull(value))
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
