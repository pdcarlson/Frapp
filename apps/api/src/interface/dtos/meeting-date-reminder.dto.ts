import { ApiProperty } from '@nestjs/swagger';
import {
  IsISO8601,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import type { MeetingDateReminderRef } from '../../application/services/meeting-date-reminder.service';

// ── "Remind me" on a minutes' Coming up date (#5672 step 2) ────────────────

/** `PUT /v1/meetings/{id}/date-reminders`. */
export class SetMeetingDateReminderDto {
  @ApiProperty({
    example: '2026-12-04',
    description: 'The date’s day, as the minutes give it (`YYYY-MM-DD`).',
  })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date: string;

  @ApiProperty({
    description:
      'The date’s words, as the minutes give them. Together with the day they name the date, which has to be in the minutes as they read now.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  text: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'When to remind the caller: from now (a couple of minutes’ grace for clock drift) to 365 days ahead. Setting it again for the same date moves it.',
  })
  @IsISO8601({ strict: true })
  remind_at: string;
}

/** One of the caller’s reminders on a minutes’ Coming up date. */
export class MeetingDateReminderDto implements MeetingDateReminderRef {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ example: '2026-12-04', description: '`YYYY-MM-DD`.' })
  date: string;

  @ApiProperty()
  text: string;

  @ApiProperty({ format: 'date-time' })
  remind_at: string;
}
