import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  Validate,
  ValidateIf,
  ValidatorConstraint,
  type ValidatorConstraintInterface,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { Transform, Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { isSupportedTimeZone, MAX_TIME_ZONE_LENGTH } from '@repo/validation';
import {
  ISO_INSTANT_MESSAGE,
  ISO_INSTANT_PATTERN,
  ISO_INSTANT_REGEX,
} from '#domain/constants/iso-instant';
import {
  CUSTOM_STATUS_MAX_LENGTH,
  MEMBER_STATUSES,
  THEMES,
  type MemberStatus,
  type Theme,
  type UserSettingsValues,
} from '#domain/entities/notification.entity';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '#domain/constants/list-query-limits';

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
    return 'quiet_hours_tz must be a named time zone the server can resolve (e.g. America/New_York), not a UTC offset such as -05:00';
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

export class ListNotificationPreferencesQueryDto {
  @ApiProperty({
    description: 'Chapter to read preferences for',
    format: 'uuid',
  })
  // Reaches `.eq('chapter_id', …)` on a uuid column; an unvalidated string
  // fails in Postgres as a 500 rather than here as a 400.
  @IsUUID()
  chapterId: string;
}

export class ListNotificationsQueryDto {
  @ApiPropertyOptional({
    description:
      'Max notifications to return. Integers outside 1–200 are rejected; omitted defaults to 50 after clamp.',
    minimum: LIST_QUERY_LIMIT_MIN,
    maximum: LIST_QUERY_LIMIT_MAX,
    default: LIST_QUERY_LIMIT_DEFAULT,
    example: LIST_QUERY_LIMIT_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIST_QUERY_LIMIT_MIN)
  @Max(LIST_QUERY_LIMIT_MAX)
  limit?: number;
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
  @IsStrictBoolean()
  is_enabled: boolean;
}

/**
 * A custom status line (#3845): at most {@link CUSTOM_STATUS_MAX_LENGTH} code
 * points, on one line.
 *
 * Counts code points, as the column's `char_length` check does, and not
 * class-validator's `@MaxLength`, which discounts a variation selector after a
 * character: forty-one "❤️" pass `@MaxLength(80)` as 41 and reach Postgres as
 * 82, which the check rejects as a 500. "One line" refuses every control
 * character and the Unicode line and paragraph separators, not only CR and LF.
 */
@ValidatorConstraint({ name: 'customStatusLine', async: false })
export class CustomStatusLineConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return (
      typeof value === 'string' &&
      [...value].length <= CUSTOM_STATUS_MAX_LENGTH &&
      !/[\p{Cc}\u2028\u2029]/u.test(value)
    );
  }

  defaultMessage(): string {
    return `custom_status must be a single line of at most ${CUSTOM_STATUS_MAX_LENGTH} characters`;
  }
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
      'Time zone for quiet hours — must be a named zone this server can resolve (e.g. America/New_York). A fixed UTC offset such as -05:00 is rejected as a format on every runtime; DST-free zone names such as Etc/GMT+5 or UTC are accepted. Pass null or an empty string to clear.',
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
    enum: THEMES,
  })
  @IsOptional()
  @IsIn(THEMES, { message: `theme must be one of: ${THEMES.join(', ')}` })
  theme?: Theme;

  @ApiPropertyOptional({
    description:
      'The status the member picks (#3845). Sending it replaces `status_expires_at` with the value sent alongside it (absent: no end time). `online` never carries an end time.',
    enum: MEMBER_STATUSES,
  })
  // Not `@IsOptional`, which also skips `null`: a null status would pass and
  // change nothing behind a 200. Absent is fine; null is refused.
  @ValidateIf((_, value) => value !== undefined)
  @IsIn(MEMBER_STATUSES, {
    message: `status must be one of: ${MEMBER_STATUSES.join(', ')}`,
  })
  status?: MemberStatus;

  @ApiPropertyOptional({
    description:
      'When `status` reverts to `online`, as an ISO 8601 instant in the future. Accepted only together with `status`; null, blank or absent means no end time (and alone is ignored).',
    nullable: true,
    type: String,
    format: 'date-time',
    pattern: ISO_INSTANT_PATTERN,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeBlankToNull(value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(ISO_INSTANT_REGEX, { message: `$property ${ISO_INSTANT_MESSAGE}` })
  status_expires_at?: string | null;

  @ApiPropertyOptional({
    description: `One short custom status line (at most ${CUSTOM_STATUS_MAX_LENGTH} characters, no line breaks). Trimmed; null or an empty string clears it, and its end time with it. Sending it replaces \`custom_status_expires_at\` with the value sent alongside it.`,
    nullable: true,
    type: String,
    maxLength: CUSTOM_STATUS_MAX_LENGTH,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeBlankToNull(value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Validate(CustomStatusLineConstraint)
  custom_status?: string | null;

  @ApiPropertyOptional({
    description:
      'When the custom status line clears, as an ISO 8601 instant in the future. Accepted only together with `custom_status`; null, blank or absent means no end time (and alone is ignored).',
    nullable: true,
    type: String,
    format: 'date-time',
    pattern: ISO_INSTANT_PATTERN,
  })
  @IsOptional()
  @Transform(({ value }) => normalizeBlankToNull(value))
  @ValidateIf((_, value) => value !== null)
  @IsString()
  @Matches(ISO_INSTANT_REGEX, { message: `$property ${ISO_INSTANT_MESSAGE}` })
  custom_status_expires_at?: string | null;
}

/**
 * `GET` and `PATCH /v1/settings`: the caller's settings. Always a full object.
 * A member who has never saved gets the defaults, not an empty body (#2885).
 */
export class UserSettingsDto implements UserSettingsValues {
  @ApiProperty({
    description:
      'Quiet hours start, as Postgres returns a `time` (HH:mm:ss). Null when no window is set; quiet hours are enforced only while start and end are both set.',
    nullable: true,
    type: String,
    example: '22:00:00',
  })
  quiet_hours_start: string | null;

  @ApiProperty({
    description: 'Quiet hours end (HH:mm:ss). Null when no window is set.',
    nullable: true,
    type: String,
    example: '08:00:00',
  })
  quiet_hours_end: string | null;

  @ApiProperty({
    description:
      'Time zone the window is evaluated in. Null means UTC while a window is set.',
    nullable: true,
    type: String,
    example: 'America/New_York',
  })
  quiet_hours_tz: string | null;

  @ApiProperty({
    description: 'Theme preference. `system` until the member saves one.',
    enum: THEMES,
  })
  theme: Theme;

  @ApiProperty({
    description:
      'The status in force now (#3845). `online` until the member picks another, and once a picked status reaches its end time.',
    enum: MEMBER_STATUSES,
  })
  status: MemberStatus;

  @ApiProperty({
    description:
      'When `status` reverts to `online`. Null: until the member changes it.',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  status_expires_at: string | null;

  @ApiProperty({
    description:
      'The custom status line in force now, or null for none (also once it has reached its end time).',
    nullable: true,
    type: String,
    example: 'At practice till 6',
  })
  custom_status: string | null;

  @ApiProperty({
    description:
      'When the custom status line clears. Null: until the member clears it.',
    nullable: true,
    type: String,
    format: 'date-time',
  })
  custom_status_expires_at: string | null;
}
