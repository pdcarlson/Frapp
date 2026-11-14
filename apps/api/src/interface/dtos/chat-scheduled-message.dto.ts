import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  MAX_MENTION_PICKS,
} from '@repo/validation';
import { MentionPickDto } from './chat.dto';

/** `POST /v1/scheduled-messages` (#4956): a text message to post later. */
export class CreateScheduledMessageDto {
  @ApiProperty({ format: 'uuid', description: 'The channel or DM to post in.' })
  @IsUUID()
  channel_id: string;

  @ApiProperty({ minLength: 1, maxLength: CHAT_MESSAGE_CONTENT_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_MESSAGE_CONTENT_MAX_LENGTH)
  content: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'When to post it: an instant, at most 120 days ahead. The client picks it on the member’s own clock.',
  })
  @IsISO8601({ strict: true })
  send_at: string;

  @ApiPropertyOptional({ type: [MentionPickDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MENTION_PICKS)
  @ValidateNested({ each: true })
  @Type(() => MentionPickDto)
  mention_picks?: MentionPickDto[];
}

/**
 * `PATCH /v1/scheduled-messages/{id}`: new text, a new time, or both. Editing
 * a message that failed to post puts it back in line.
 */
export class UpdateScheduledMessageDto {
  @ApiPropertyOptional({
    minLength: 1,
    maxLength: CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_MESSAGE_CONTENT_MAX_LENGTH)
  content?: string;

  @ApiPropertyOptional({ format: 'date-time' })
  @IsOptional()
  @IsISO8601({ strict: true })
  send_at?: string;

  @ApiPropertyOptional({
    type: [MentionPickDto],
    description: 'The `@` picks for the new `content`; read only with it.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(MAX_MENTION_PICKS)
  @ValidateNested({ each: true })
  @Type(() => MentionPickDto)
  mention_picks?: MentionPickDto[];
}

export class ListScheduledMessagesQueryDto {
  @ApiPropertyOptional({
    format: 'uuid',
    description: 'Only this channel’s; every channel’s when left out.',
  })
  @IsOptional()
  @IsUUID()
  channel_id?: string;
}

export class ScheduledMessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty()
  content: string;

  @ApiProperty({ type: [MentionPickDto], nullable: true })
  mention_picks: MentionPickDto[] | null;

  @ApiProperty({ format: 'date-time' })
  send_at: string;

  @ApiProperty({
    enum: ['pending', 'failed'],
    description:
      '`failed`: it did not post at its time. Edit it to try again, or delete it.',
  })
  status: 'pending' | 'failed';

  @ApiProperty({
    enum: ['no_access', 'not_sendable', 'send_failed'],
    nullable: true,
    description:
      'Why a failed message did not post: `no_access` the author can no longer post there; `not_sendable` the channel refused the message; `send_failed` it kept failing.',
  })
  failure_reason: 'no_access' | 'not_sendable' | 'send_failed' | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}
