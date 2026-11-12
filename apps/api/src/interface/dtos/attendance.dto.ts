import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { EventAttendanceStatus } from '#domain/entities/event-attendance.entity';
import {
  CHECK_IN_SCREEN_CHECKS,
  type CheckInScreenCheck,
} from '#domain/utils/check-in-screen';

/**
 * Self check-in payload.
 *
 * Every field is optional because the four surfaces send different subsets, and
 * the *server* decides which are required for a given event rather than the DTO:
 *
 * - the chat event card (web) posts an empty body — plain self check-in;
 * - the mobile scanner (s18) posts `token` after reading the host's QR;
 * - a member whose camera failed posts `manualCode` typed off s22;
 * - either mobile path also posts `lat`/`lng` (and `accuracy_meters` when the
 *   phone reports one) whenever it can read a location: the event's drawn
 *   zone, or the officer's screen showing the code (#4532), checks it.
 *
 * `AttendanceService.checkIn` rejects a check-in that arrives without
 * coordinates when either check applies (400), and one without a code once
 * the code has been shown (403), so "optional here" never means "optional in
 * effect".
 */
export class CheckInDto {
  @ApiPropertyOptional({
    description:
      'Rotating token read from the host QR code (s22). Valid for its 30s window and the one immediately before it.',
  })
  @IsOptional()
  @IsString()
  // Loose upper bound: a real token is a fixed-width base64url HMAC, but the
  // length check that matters is the constant-time comparison in
  // `verifyCheckInToken`. This only stops an absurd body reaching the HMAC.
  @MaxLength(256)
  token?: string;

  @ApiPropertyOptional({
    description:
      'Short rotating code typed off the host screen when the camera fails (e.g. "4KQ-88").',
    example: '4KQ-88',
  })
  @IsOptional()
  @IsString()
  @MaxLength(16)
  manualCode?: string;

  @ApiPropertyOptional({
    description:
      "Scanner latitude. Required when the event defines a check-in geofence, or when an officer's screen showing the code reported where it is; ignored otherwise.",
  })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({
    description:
      "Scanner longitude. Required when the event defines a check-in geofence, or when an officer's screen showing the code reported where it is; ignored otherwise.",
  })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    description:
      "The scanner's reported location accuracy in meters. Widens the distance allowed from the officer's screen, up to 50 m. Omit when the phone reports none.",
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(100_000)
  accuracy_meters?: number;
}

/**
 * Where the host screen (s22) is, sent about once a minute while it shows the
 * code (#4532). Every field is optional: a screen that can't tell where it is
 * (location refused, or no fix) still reports that it is showing the code,
 * which makes the code required for the event.
 */
export class CheckInScreenDto {
  @ApiPropertyOptional({ description: "The screen's latitude." })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({ description: "The screen's longitude." })
  @IsOptional()
  @IsLongitude()
  lng?: number;

  @ApiPropertyOptional({
    description:
      "The screen's reported accuracy in meters. A fix less precise than 100 m isn't stored, and distance isn't checked.",
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, allowInfinity: false })
  @IsPositive()
  @Max(100_000)
  accuracy_meters?: number;
}

export class CheckInScreenResultDto {
  @ApiProperty({
    enum: CHECK_IN_SCREEN_CHECKS,
    description:
      "How presence is checked for this event: `zone` (its drawn zone), `screen` (this screen knows where it is; members must be within 100 yards of it or of another located screen, plus both phones' accuracy up to 50 m each), `other_screen` (this screen can't tell where it is, but another officer's can, so members must be near that one), `no_location` (no screen could tell where it is, so the code is required but distance isn't checked), or `not_open` / `closed` (outside the check-in window; nothing was stored).",
  })
  check: CheckInScreenCheck;
}

export class UpdateAttendanceDto {
  @ApiProperty({ enum: ['PRESENT', 'EXCUSED', 'ABSENT', 'LATE'] })
  @IsEnum(['PRESENT', 'EXCUSED', 'ABSENT', 'LATE'])
  status: EventAttendanceStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  excuse_reason?: string;
}

export class AutoAbsentResultDto {
  @ApiProperty({
    description:
      'Number of members newly recorded ABSENT. 0 when the event is not mandatory and targets no roles, or when everyone required already has an attendance record.',
  })
  marked: number;
}

/** One attendance row, as `GET /v1/events/:eventId/attendance/me` returns it. */
export class EventAttendanceDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  event_id: string;

  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty({ enum: ['PRESENT', 'EXCUSED', 'ABSENT', 'LATE'] })
  status: EventAttendanceStatus;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  check_in_time: string | null;

  @ApiProperty({ type: String, nullable: true })
  excuse_reason: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  marked_by: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

/**
 * The caller's own attendance for an event. Wrapped rather than a bare row so
 * "no record" is `{ attendance: null }`, a JSON body, not an empty 200.
 */
export class MyAttendanceDto {
  @ApiProperty({
    type: EventAttendanceDto,
    nullable: true,
    description:
      "The caller's row, or null when they have none (not checked in, and not yet marked).",
  })
  attendance: EventAttendanceDto | null;
}
