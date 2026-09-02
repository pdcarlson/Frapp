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

/**
 * The message a bookmark points at, as the Bookmarks view renders it (#462).
 *
 * A narrow projection rather than the whole `ChatMessage`: the panel draws an
 * author, a timestamp and a preview, and jumps to the message in its channel.
 * Declaring it explicitly is what keeps the generated SDK from typing this
 * endpoint's response `never` — the defect #1049 tracks across the
 * member-facing reads that never got a response schema.
 */
export class BookmarkedMessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Null for an imported archive message, which names its author in author_name instead.',
  })
  sender_id: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  author_name?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  author_avatar_path?: string | null;

  /**
   * The author's id in the source system, for an imported archive message.
   * Declared because `resolveAuthorLabel` in `@repo/hooks` reads it as part of
   * the author fallback chain — omitting it here would type it away on the
   * client while it still arrived on the wire.
   */
  @ApiProperty({ type: String, nullable: true, required: false })
  author_external_id?: string | null;

  @ApiProperty({
    type: String,
    description:
      'Reads “[message deleted]” once the message is deleted — the bookmark keeps its row and surfaces that placeholder rather than disappearing.',
  })
  content: string;

  @ApiProperty({ type: Boolean })
  is_deleted: boolean;

  @ApiProperty()
  created_at: string;
}

/**
 * One of the caller's own bookmarks (#462).
 *
 * There is deliberately no `user_id` on the wire and no count of who else
 * bookmarked the message: every row this endpoint returns already belongs to
 * the caller, and `spec/behavior/chat/README.md` is explicit that nobody —
 * channel admins included — may see who bookmarked what. Putting an owner
 * field here would be the first step toward a client rendering one.
 */
export class BookmarkDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  message_id: string;

  @ApiProperty({
    type: String,
    description: 'When the caller saved it — not when the message was sent.',
  })
  created_at: string;

  @ApiProperty({ type: BookmarkedMessageDto })
  message: BookmarkedMessageDto;

  /**
   * False when the caller has since lost access to the message's channel, in
   * which case `message` is redacted and the client must not offer a jump —
   * jumping would land the member in a channel they cannot open.
   */
  @ApiProperty({ type: Boolean })
  message_available: boolean;
}

/**
 * What `POST /v1/bookmarks/messages/{id}` returns: the bookmark row itself,
 * with no joined message.
 *
 * Separate from {@link BookmarkDto} rather than reusing it with an optional
 * `message`, because the two really are different shapes and an optional field
 * would push the "is it there?" question onto every client. The caller already
 * holds the message it just bookmarked; re-sending it would be bytes for
 * nothing.
 */
export class BookmarkRefDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  message_id: string;

  @ApiProperty({ format: 'uuid' })
  chapter_id: string;

  @ApiProperty()
  created_at: string;
}
