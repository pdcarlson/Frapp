import {
  ArrayMaxSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  MAX_MENTION_PICKS,
} from '@repo/validation';
import { MentionPickDto, MessageAttachmentDto } from './chat.dto';

/**
 * `POST /v1/scheduled-messages` (#4956): a message to post later, as the
 * composer holds it: text, files already uploaded, and a quote or a thread
 * (#4971).
 */
export class CreateScheduledMessageDto {
  @ApiProperty({ format: 'uuid', description: 'The channel or DM to post in.' })
  @IsUUID()
  channel_id: string;

  @ApiProperty({
    minLength: 0,
    maxLength: CHAT_MESSAGE_CONTENT_MAX_LENGTH,
    description: 'May be empty only when `attachments` is not, as on a send.',
  })
  @IsString()
  @MaxLength(CHAT_MESSAGE_CONTENT_MAX_LENGTH)
  content: string;

  @ApiPropertyOptional({
    type: [MessageAttachmentDto],
    description:
      'Files uploaded through `POST /v1/channels/{id}/upload-url`, as `SendMessageDto.attachments`. Deleted from storage if the scheduled message is deleted before it posts.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Quote this message, as `SendMessageDto.reply_to_id`. If it is gone when this posts, it posts without the quote.',
  })
  @IsOptional()
  @IsUUID()
  reply_to_id?: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Post inside this message’s thread, as `SendMessageDto.thread_root_id`. Not with `reply_to_id`.',
  })
  @IsOptional()
  @IsUUID()
  thread_root_id?: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'When to post it: a date-time with its offset (`Z` or `±hh:mm`), at most 120 days ahead. The client picks it on the member’s own clock.',
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
    minLength: 0,
    maxLength: CHAT_MESSAGE_CONTENT_MAX_LENGTH,
    description:
      'May be empty only on a message with files. Files, the quote and the thread can’t be changed.',
  })
  @IsOptional()
  @IsString()
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

/** A file a scheduled message carries, as its list shows it. */
export class ScheduledAttachmentDto {
  @ApiProperty()
  filename: string;

  @ApiProperty()
  content_type: string;
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

  @ApiProperty({
    type: [ScheduledAttachmentDto],
    description: 'The files it carries; empty for a text message.',
  })
  attachments: ScheduledAttachmentDto[];

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The message it quotes.',
  })
  reply_to_id: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'The thread it posts into.',
  })
  thread_root_id: string | null;

  @ApiProperty({ format: 'date-time' })
  send_at: string;

  @ApiProperty({
    enum: ['pending', 'failed'],
    description:
      '`failed`: it did not post at its time. Edit it to try again, or delete it.',
  })
  status: 'pending' | 'failed';

  @ApiProperty({
    enum: ['no_access', 'chapter_locked', 'not_sendable', 'send_failed'],
    nullable: true,
    description:
      'Why a failed message did not post: `no_access` the author can no longer post there; `chapter_locked` the chapter is read-only for billing; `not_sendable` the channel refused the message; `send_failed` it kept failing.',
  })
  failure_reason:
    'no_access' | 'chapter_locked' | 'not_sendable' | 'send_failed' | null;

  @ApiProperty({ format: 'date-time' })
  created_at: string;

  @ApiProperty({ format: 'date-time' })
  updated_at: string;
}
