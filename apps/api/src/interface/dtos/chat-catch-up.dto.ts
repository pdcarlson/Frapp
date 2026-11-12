import {
  IsISO8601,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAT_CATCH_UP_MAX_UNREAD,
  CHAT_CATCH_UP_POINT_KINDS,
  CHAT_CATCH_UP_STATUSES,
  CHAT_CATCH_UP_UNAVAILABLE_REASONS,
} from '@repo/validation';

export class ChatCatchUpUnreadDto {
  @ApiProperty({
    description:
      'How many messages were new to the member when they opened the channel, as its unread badge counted them.',
    minimum: 1,
    maximum: CHAT_CATCH_UP_MAX_UNREAD,
  })
  @IsInt()
  @Min(1)
  @Max(CHAT_CATCH_UP_MAX_UNREAD)
  count: number;

  @ApiProperty({
    type: String,
    format: 'date-time',
    description: 'When the member opened the channel.',
  })
  @IsISO8601({ strict: true })
  as_of: string;
}

export class ChatCatchUpRequestDto {
  @ApiProperty({ format: 'uuid', description: 'The channel to summarize in.' })
  @IsUUID()
  channel_id: string;

  @ApiPropertyOptional({
    format: 'uuid',
    description:
      'Summarize one thread: its first message and every reply. Exactly one of `thread_root_id`, `since` and `unread` is given.',
  })
  @IsOptional()
  @IsUUID()
  thread_root_id?: string;

  @ApiPropertyOptional({
    type: String,
    format: 'date-time',
    description:
      "Summarize the channel's messages from this moment on. No further back than 30 days.",
  })
  @IsOptional()
  @IsISO8601({ strict: true })
  since?: string;

  @ApiPropertyOptional({
    type: ChatCatchUpUnreadDto,
    description:
      'Summarize what was new when the member opened the channel. Opening a channel marks it read, so the client says how many messages were new and when it opened; the server finds where that stretch starts.',
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ChatCatchUpUnreadDto)
  unread?: ChatCatchUpUnreadDto;
}

export class ChatCatchUpPointDto {
  @ApiProperty({
    description: `What the point is. One of ${CHAT_CATCH_UP_POINT_KINDS.join(', ')} today; a client shows a kind it does not know with the last group.`,
    example: 'decision',
  })
  kind: string;

  @ApiProperty({ description: 'One sentence, plain text.' })
  text: string;

  @ApiProperty({
    format: 'uuid',
    description: 'The message the point rests on, which the point opens.',
  })
  message_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Set when that message is a thread reply: the thread to open.',
  })
  thread_root_id: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'Who wrote the message.',
  })
  author_id: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  sent_at: string;

  @ApiProperty({
    description:
      'The words of that message the point rests on. The server found them in the message, word for word.',
  })
  quote: string;
}

export class ChatCatchUpDto {
  @ApiProperty({
    description: `How the request ended: ${CHAT_CATCH_UP_STATUSES.join(', ')}. \`summarized\` carries points; every other status carries none.`,
    example: 'summarized',
  })
  status: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: `Why nothing was attempted, when \`status\` is \`unavailable\`: ${CHAT_CATCH_UP_UNAVAILABLE_REASONS.join(', ')}.`,
  })
  reason: string | null;

  @ApiProperty({ type: [ChatCatchUpPointDto] })
  points: ChatCatchUpPointDto[];

  @ApiProperty({ description: 'Messages the summary read.' })
  messages_read: number;

  @ApiProperty({
    description:
      'Messages in the stretch the summary could have read. More than `messages_read` when the stretch was longer than one summary reads; the newest were read.',
  })
  messages_total: number;

  @ApiProperty({
    description:
      'Messages left out because their author has not agreed to AI reading their messages. A count, never who.',
  })
  left_out_messages: number;

  @ApiProperty({
    description:
      'Points dropped because their quote was not in the message they named.',
  })
  unverified_points: number;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  covers_from: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  covers_to: string | null;
}
