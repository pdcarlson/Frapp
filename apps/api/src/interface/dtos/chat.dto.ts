import {
  ArrayMaxSize,
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
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CHAT_MESSAGE_CONTENT_MAX_LENGTH } from '@repo/validation';
import {
  CHAT_MESSAGE_KINDS,
  SETTABLE_NOTIFICATION_KINDS,
} from '../../domain/entities/chat.entity';
import type { SettableNotificationKind } from '../../domain/entities/chat.entity';

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

  // Nullable, unlike `CreateChannelDto.category_id`: a new channel starting
  // uncategorized just omits the field, but moving an *existing* channel back
  // to uncategorized has to be expressible, and `undefined` is indistinguishable
  // from "don't touch this field" once the body is JSON-serialized.
  // `@IsOptional()` treats `null` the same as `undefined` (skips `@IsUUID()`),
  // so this validates and reaches the repository update as a real `null`.
  // Both `type: String` AND `format: 'uuid'` must be explicit here — verified
  // empirically. `type` alone with `nullable: true` plus `@IsUUID()` present
  // emits `{"type":"object","nullable":true}` in the generated schema (an
  // `@nestjs/swagger` inference quirk this exact combination triggers); adding
  // `format: 'uuid'` short-circuits whatever path produces that, and the
  // schema comes out as the intended `{"type":"string","format":"uuid","nullable":true}`.
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsUUID()
  category_id?: string | null;

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

/**
 * One file the client uploaded to the `chat` bucket and is attaching.
 *
 * `storage_path` is validated for shape here and for OWNERSHIP in
 * `ChatService.validateAttachmentInputs`, which re-checks it against the prefix
 * the API itself minted. A DTO cannot do that second half — it does not know
 * which channel the request is for — and the ownership check is the one that
 * matters, so neither stands alone.
 */
export class MessageAttachmentDto {
  @ApiProperty({ maxLength: 1024 })
  @IsString()
  @MinLength(1)
  @MaxLength(1024)
  storage_path: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  filename: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  content_type: string;

  /** Reported by the browser; advisory, and never trusted as the stored size. */
  @ApiPropertyOptional({ minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  byte_size?: number;
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

  /**
   * May be empty — but only when `attachments` is not. A message that is nothing
   * but a file is a real message, and the emptiness rule is therefore a
   * relationship between two fields, which a per-field validator cannot express;
   * `ChatService.sendMessage` enforces it.
   */
  @ApiProperty({ minLength: 0, maxLength: CHAT_MESSAGE_CONTENT_MAX_LENGTH })
  @IsString()
  @MaxLength(CHAT_MESSAGE_CONTENT_MAX_LENGTH)
  content: string;

  /**
   * Files uploaded through `POST /v1/channels/{id}/upload-url` that belong to
   * this message.
   *
   * Attachments are rows, not text. The composer used to append
   * `📎 <name> (<path>)` into `content`, which left the object with no link back
   * to the message it belonged to.
   */
  @ApiPropertyOptional({ type: [MessageAttachmentDto] })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => MessageAttachmentDto)
  attachments?: MessageAttachmentDto[];

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
  @ApiProperty({ minLength: 1, maxLength: CHAT_MESSAGE_CONTENT_MAX_LENGTH })
  @IsString()
  @MinLength(1)
  @MaxLength(CHAT_MESSAGE_CONTENT_MAX_LENGTH)
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

  @ApiPropertyOptional({
    description:
      'File size in bytes, if known. Rejected server-side against the upload size ceiling when present.',
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  size_bytes?: number;
}

export class ChannelUnreadCountDto {
  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({
    type: Number,
    description:
      'Messages in this channel newer than the caller’s read cursor, excluding their own and deleted ones. A channel never opened counts all of them.',
  })
  unread_count: number;

  @ApiProperty({
    type: Number,
    description:
      'Subset of unread_count that mentions the caller. Mentions are resolved server-side at send time.',
  })
  mention_count: number;
}

/**
 * The three per-channel notification levels (ADR-06), mirroring the
 * `chat_notification_preferences.level` CHECK constraint.
 *
 * `off` is what the UI calls "muted". It is not absolute: `decidePush` lifts it
 * when the message mentions the recipient, which is the spec'd mention override
 * (`spec/behavior/notifications.md` § Per-Channel Mute). `mentions` is the
 * default for ordinary channels, so setting a channel to `mentions` is a reset
 * to default rather than a distinct third state the user has to reason about.
 */
export const CHAT_NOTIFICATION_LEVELS = ['all', 'mentions', 'off'] as const;

export class SetChannelNotificationLevelDto {
  @ApiProperty({
    enum: CHAT_NOTIFICATION_LEVELS,
    description:
      'all = every message; mentions = only when you are mentioned (default); off = muted, though @mentions still notify.',
  })
  @IsIn(CHAT_NOTIFICATION_LEVELS)
  level: (typeof CHAT_NOTIFICATION_LEVELS)[number];
}

export class ChannelNotificationPreferenceDto {
  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({ enum: CHAT_NOTIFICATION_LEVELS })
  level: (typeof CHAT_NOTIFICATION_LEVELS)[number];
}

export class SetKindNotificationLevelDto {
  @ApiProperty({
    enum: CHAT_NOTIFICATION_LEVELS,
    description:
      'all = every message of this kind; mentions = only when you are mentioned; off = muted, though @mentions still notify — the one exception is the system_audit kind, whose off a mention does not lift. A channel-scoped preference outranks this one for messages in that channel.',
  })
  @IsIn(CHAT_NOTIFICATION_LEVELS)
  level: (typeof CHAT_NOTIFICATION_LEVELS)[number];
}

export class KindNotificationPreferenceDto {
  @ApiProperty({
    enum: SETTABLE_NOTIFICATION_KINDS,
    description:
      'A `chat_messages.kind`. `imported` and `loading` are absent by design — the first is refused by the push worker before any preference is read, and the second is an internal optimistic placeholder rather than a category of message a member receives.',
  })
  kind: SettableNotificationKind;

  @ApiProperty({
    enum: CHAT_NOTIFICATION_LEVELS,
    type: String,
    nullable: true,
    description:
      "The member's chapter-wide override for this kind, or null when they have set none. Null is not a level: what a kind falls back to depends on the channel a message lands in (an `announcement` resolves `all` in a channel named `announcements` and `mentions` elsewhere), so there is no single default to report here. For the effective level of a real message, read GET /v1/channels/notification-preferences.",
  })
  level: (typeof CHAT_NOTIFICATION_LEVELS)[number] | null;
}

/** Bounds one request to roughly one page of distinct message authors (#1231). */
export const MAX_AUTHOR_AVATAR_PATHS_PER_REQUEST = 50;

export class ResolveAuthorAvatarsDto {
  @ApiProperty({
    type: [String],
    format: 'uuid',
    description:
      "IDs of already-fetched messages in this channel to resolve avatar paths for. The server derives the avatar path set itself (`chat_messages.author_avatar_path` for rows matching both this channel and this id list) rather than trusting a caller-supplied storage path — the `chat-archive` bucket has no storage RLS, and an avatar path is otherwise indistinguishable from another message's attachment path.",
  })
  @IsArray()
  @ArrayMaxSize(MAX_AUTHOR_AVATAR_PATHS_PER_REQUEST)
  @IsUUID(undefined, { each: true })
  message_ids: string[];
}
