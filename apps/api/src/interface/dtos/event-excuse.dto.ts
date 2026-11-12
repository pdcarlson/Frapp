import { IsIn, IsNotEmpty, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiProperty } from '@nestjs/swagger';
import { EVENT_EXCUSE_REASON_MAX } from '@repo/validation';
import type { EventExcuseStatus } from '#domain/entities/event-excuse.entity';

const STATUSES = ['PENDING', 'APPROVED', 'DECLINED'] as const;

/** A member's excuse, as `POST /v1/events/:eventId/excuses` takes it. */
export class SubmitEventExcuseDto {
  @ApiProperty({
    description: `One line on why the member can't attend, 1 to ${EVENT_EXCUSE_REASON_MAX} characters after trimming.`,
    maxLength: EVENT_EXCUSE_REASON_MAX,
  })
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(EVENT_EXCUSE_REASON_MAX)
  reason: string;
}

/** The receiver's decision on one excuse. */
export class DecideEventExcuseDto {
  @ApiProperty({ enum: ['APPROVED', 'DECLINED'] })
  @IsIn(['APPROVED', 'DECLINED'])
  decision: 'APPROVED' | 'DECLINED';
}

export class EventExcuseDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({ format: 'uuid' })
  event_id: string;

  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty()
  reason: string;

  @ApiProperty({ enum: STATUSES })
  status: EventExcuseStatus;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  decided_by: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  decided_at: string | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}

/** One excuse in the receiver's list, with the sender's name. */
export class EventExcuseWithMemberDto extends EventExcuseDto {
  @ApiProperty({
    description: "The sender's display name; empty when they set none.",
  })
  display_name: string;
}

export class ExcuseReceiverDto {
  @ApiProperty({ format: 'uuid' })
  user_id: string;

  @ApiProperty()
  display_name: string;
}

/**
 * The caller's own excuse for an event, and who it goes to. Wrapped so "none"
 * is `{ excuse: null }`, a JSON body.
 */
export class MyEventExcuseDto {
  @ApiProperty({
    type: EventExcuseDto,
    nullable: true,
    description: "The caller's excuse, or null when they sent none.",
  })
  excuse: EventExcuseDto | null;

  @ApiProperty({
    type: ExcuseReceiverDto,
    nullable: true,
    description:
      'The event\'s creator, who receives it ("Excuse sent to Jake"). Null when the event has no creator in the chapter, or the caller made it: it then goes to the officers who can edit events.',
  })
  receiver: ExcuseReceiverDto | null;
}
