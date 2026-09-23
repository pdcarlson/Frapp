import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHAT_REPORT_REASONS,
  CHAT_REPORT_RESOLUTION_STATUSES,
  CHAT_REPORT_STATUSES,
} from '#domain/entities/chat-moderation.entity';
import type {
  ChatReportReason,
  ChatReportResolutionStatus,
  ChatReportStatus,
} from '#domain/entities/chat-moderation.entity';

/**
 * Matches `chat_message_reports_details_len`. A cap rather than an unbounded
 * text field so a report cannot be used as a storage channel; exceeding it is a
 * 400 here instead of a 23514 surfacing as a 500.
 */
const REPORT_DETAILS_MAX_LENGTH = 1000;

export class CreateChatReportDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The message being reported. Must be one the caller can already read — reporting authorizes as a read of the message’s channel.',
  })
  @IsUUID()
  message_id: string;

  @ApiProperty({
    enum: CHAT_REPORT_REASONS,
    description: 'Mirrors the chat_message_reports_reason_check constraint.',
  })
  @IsIn(CHAT_REPORT_REASONS)
  reason: ChatReportReason;

  @ApiPropertyOptional({
    maxLength: REPORT_DETAILS_MAX_LENGTH,
    description: 'Optional free text from the reporter.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(REPORT_DETAILS_MAX_LENGTH)
  details?: string;
}

export class ResolveChatReportDto {
  @ApiProperty({
    enum: CHAT_REPORT_RESOLUTION_STATUSES,
    description:
      '`open` is deliberately not accepted: the answer to “it happened again” is a new report, not a revived one.',
  })
  @IsIn(CHAT_REPORT_RESOLUTION_STATUSES)
  status: ChatReportResolutionStatus;
}

export class ListChatReportsQueryDto {
  @ApiPropertyOptional({
    enum: CHAT_REPORT_STATUSES,
    default: 'open',
    description:
      'Which slice of the queue to read. Defaults to `open` — the resolved statuses are history.',
  })
  @IsOptional()
  @IsIn(CHAT_REPORT_STATUSES)
  status?: ChatReportStatus;
}

/**
 * One report as the officer queue serves it.
 *
 * **There is deliberately no `reporter_user_id` on the wire.** The queue is
 * chapter-wide and a `channels:manage` holder can be reported like anybody
 * else, so a field naming the reporter would answer "who reported me" for
 * exactly the member with the most leverage to retaliate.
 * `spec/behavior/chat/README.md`: "There is no surface, API route, or
 * repository method that answers 'who reported me'." The repository strips the
 * column on every exit — nothing in this app serializes to a declared DTO, so
 * the strip rather than this class is what keeps it off the response.
 */
export class ChatReportDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Null once the reported message was hard-deleted (a channel delete, or the Discord import purge). The report outlives it; the reported_* fields are the evidence.',
  })
  message_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The message content as it read when the report was filed, so a sender soft-deleting their own message cannot blank the evidence.',
  })
  reported_content: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Null for an imported archive message, which names its author in reported_author_name instead.',
  })
  reported_sender_id: string | null;

  @ApiProperty({ type: String, nullable: true })
  reported_author_name: string | null;

  @ApiProperty({ enum: CHAT_REPORT_REASONS })
  reason: ChatReportReason;

  @ApiProperty({ type: String, nullable: true })
  details: string | null;

  @ApiProperty({ enum: CHAT_REPORT_STATUSES })
  status: ChatReportStatus;

  @ApiProperty()
  created_at: string;

  @ApiProperty({ type: String, nullable: true })
  resolved_at: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  resolved_by: string | null;
}

/**
 * What the report-scoped removal answers with: the report, now `actioned`,
 * whether its message was already gone, and which channel it was in.
 *
 * The route is idempotent on the message — one its sender, an ordinary delete,
 * a sibling report's removal or an earlier half-finished attempt already
 * removed still closes the report — so a bare report would leave the client
 * claiming a removal this call did not make. The flag lets it say which.
 *
 * `channel_id` is there for the client's cache, not for the officer: the
 * response still carries no part of the message, and the id opens nothing.
 */
export class ChatReportRemovalDto extends ChatReportDto {
  @ApiProperty({
    description:
      'True when the message was already soft-deleted before this call, so nothing was removed now; the report (and any other open report on the message) is marked actioned either way.',
  })
  message_already_deleted: boolean;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "The channel the removed message was in, so a client can blank that one timeline's cached copy instead of refetching every timeline. An id only: it grants no read, and a direct message stays closed to the officer. Null when the message row no longer exists.",
  })
  channel_id: string | null;
}

export class CreateChatBlockDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The `users.id` of the member to block. Must be a member of the active chapter — a block is scoped to one chapter.',
  })
  @IsUUID()
  user_id: string;
}

/**
 * The caller's own block list.
 *
 * An object rather than a bare array so the payload has somewhere to grow, and
 * ids rather than rows because ids are what a client needs: the contract
 * requires the client to apply its own list to messages arriving over the
 * Realtime `postgres_changes` echo, which carries no viewer and therefore
 * cannot be server-masked.
 */
export class ChatBlockListDto {
  @ApiProperty({
    type: [String],
    description:
      'users.id values the caller has blocked in the active chapter. An empty array means nobody is blocked — a failed request is NOT an empty list, and a client must hold unmaskable messages rather than render them when the read fails.',
  })
  blocked_user_ids: string[];
}

/**
 * One block row, as returned by the (idempotent) block write.
 *
 * No `blocker_user_id`: it is the caller's own id and therefore not news to
 * them, but "who has blocked whom" must never be a field a client can read off
 * a block response.
 */
export class ChatBlockDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty({ format: 'uuid' })
  blocked_user_id: string;

  @ApiProperty()
  created_at: string;
}
