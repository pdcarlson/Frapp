import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CHAT_MESSAGE_KINDS } from '../../domain/entities/chat.entity';

const CHANNEL_TYPES = ['PUBLIC', 'PRIVATE', 'ROLE_GATED'] as const;

export class CreateChannelDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({ enum: CHANNEL_TYPES })
  @IsIn(CHANNEL_TYPES)
  type: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_permissions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  is_read_only?: boolean;
}

export class UpdateChannelDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_permissions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  is_read_only?: boolean;
}

export class CreateDmDto {
  @ApiProperty({ description: 'The other member user ID' })
  @IsUUID()
  member_id: string;
}

export class CreateGroupDmDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsUUID(undefined, { each: true })
  member_ids: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;
}

export class CreateCategoryDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(0)
  display_order?: number;
}

export class SendMessageDto {
  /**
   * Client-generated idempotency key. The server dedupes on
   * `(channel_id, sender_id, client_message_id)` via the partial unique
   * index, so a retried POST with the same id returns the existing row
   * with `deduplicated: true` instead of inserting again.
   */
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  client_message_id: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  content: string;

  /**
   * Extended hot-path kind (Chunk 02). Defaults to `text` server-side
   * when omitted so existing callers stay backward-compatible. The
   * default is intentionally NOT declared in the OpenAPI schema so the
   * generated SDK exposes `kind` as a true optional rather than a
   * "required with default" (openapi-typescript inlines the default and
   * marks the field non-nullable, which breaks plain `text` callers).
   */
  @ApiPropertyOptional({ enum: CHAT_MESSAGE_KINDS })
  @IsOptional()
  @IsIn(CHAT_MESSAGE_KINDS)
  kind?: (typeof CHAT_MESSAGE_KINDS)[number];

  /** Inline card payload for rich kinds (event, poll, task, …). */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  reply_to_id?: string;

  /**
   * Free-form client annotations, persisted verbatim onto the message row.
   * `@IsObject` is the type check `payload` above already carries — without it
   * this was the one request-DTO property in the API with a gate but no
   * constraint, so a caller could store a bare string or array in a column the
   * readers treat as an object. Overall size stays bounded by the body parser's
   * default 100 kB JSON limit.
   */
  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * Per-user reaction / vote / RSVP / card-action. Writes to
 * `chat_message_actions` (Chunk 02). For `action_type === "vote"` the
 * server UPSERTS — same row, replaced `payload` — so a poll vote can
 * be changed without thrashing the Realtime subscription.
 */
export class ChatMessageActionDto {
  @ApiProperty({
    description:
      'Action discriminator. `reaction:<emoji>` for emoji reactions, `vote` for poll votes (UPSERT), free-form for card actions.',
  })
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  action_type: string;

  @ApiPropertyOptional({ type: Object })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}

export class EditMessageDto {
  // Same bound as SendMessageDto.content — without it an edit could grow a
  // message past the limit its original POST was held to.
  @ApiProperty({ maxLength: 10_000 })
  @IsString()
  @MinLength(1)
  @MaxLength(10_000)
  content: string;
}

export class ReactionDto {
  @ApiProperty({ description: 'Emoji string (e.g. "👍")' })
  @IsString()
  @MaxLength(50)
  emoji: string;
}

export class RequestChatUploadUrlDto {
  @ApiProperty({ description: 'Original filename' })
  @IsString()
  @MaxLength(255)
  filename: string;

  @ApiProperty({ description: 'MIME content type (e.g. image/png)' })
  @IsString()
  @MaxLength(255)
  content_type: string;
}
