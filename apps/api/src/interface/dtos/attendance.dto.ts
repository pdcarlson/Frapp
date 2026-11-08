import {
  IsEnum,
  IsLatitude,
  IsLongitude,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { EventAttendanceStatus } from '#domain/entities/event-attendance.entity';

/**
 * Self check-in payload.
 *
 * Every field is optional because the four surfaces send different subsets, and
 * the *server* decides which are required for a given event rather than the DTO:
 *
 * - the chat event card (web) posts an empty body — plain self check-in;
 * - the mobile scanner (s18) posts `token` after reading the host's QR;
 * - a member whose camera failed posts `manualCode` typed off s22;
 * - either mobile path also posts `lat`/`lng` when the event carries a geofence.
 *
 * `AttendanceService.checkIn` rejects a zoned event that arrives without
 * coordinates (400), so "optional here" never means "optional in effect".
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
      "Scanner latitude. Required when the event defines a check-in geofence; ignored when it doesn't.",
  })
  @IsOptional()
  @IsLatitude()
  lat?: number;

  @ApiPropertyOptional({
    description:
      "Scanner longitude. Required when the event defines a check-in geofence; ignored when it doesn't.",
  })
  @IsOptional()
  @IsLongitude()
  lng?: number;
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
      'The caller\'s row, or null when they have none (not checked in, and not yet marked).',
  })
  attendance: EventAttendanceDto | null;
}
