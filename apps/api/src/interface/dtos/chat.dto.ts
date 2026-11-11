import {
  ArrayMaxSize,
  IsArray,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { IsStrictBoolean } from '../decorators/is-strict-boolean.decorator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CHANNEL_ACCESS_ENTRY_PATTERN,
  CHANNEL_ACCESS_LIST_MAX,
  CHAT_CHAPTER_LEVELS,
  CHAT_MESSAGE_CONTENT_MAX_LENGTH,
  CHAT_MESSAGE_FLAGS,
  CHAT_NOTIFICATION_LEVELS,
  type ChatChapterLevel,
  type ChatMessageFlag,
} from '@repo/validation';
import { POSITION_MAX } from '#domain/constants/field-limits';
import {
  CHAT_MESSAGE_KINDS,
  CHAT_THREAD_FOLLOW_STATES,
  SETTABLE_NOTIFICATION_KINDS,
} from '#domain/entities/chat.entity';
import type {
  ChatThreadFollowState,
  MessageType,
  SettableNotificationKind,
} from '#domain/entities/chat.entity';
import {
  ISO_INSTANT_MESSAGE,
  ISO_INSTANT_PATTERN,
  ISO_INSTANT_REGEX,
} from '#domain/constants/iso-instant';
import {
  LIST_QUERY_LIMIT_DEFAULT,
  LIST_QUERY_LIMIT_MAX,
  LIST_QUERY_LIMIT_MIN,
} from '#domain/constants/list-query-limits';

const CHANNEL_TYPES = ['PUBLIC', 'PRIVATE', 'ROLE_GATED'] as const;

const ENTRY_MESSAGE =
  'each entry must be tier:<id> or role:<id>, as GET /v1/channels/access-options lists them';

const WHO_CAN_SEE_DESCRIPTION =
  "Who can see the channel (#3722): null for everyone in the chapter, or the tiers and roles named, each as `tier:<id>` or `role:<id>` from GET /v1/channels/access-options. Not empty. Left out, a new channel copies its category's list (everyone with no category).";

const WHO_CAN_POST_DESCRIPTION =
  "Who can post (#3722): null for everyone who can see it, or the tiers and roles named, each as `tier:<id>` or `role:<id>`. Not empty. Someone on this list who cannot see the channel still cannot post. Left out, a new channel copies its category's list.";

const LEGACY_FIELD_DESCRIPTION =
  'Replaced by `who_can_see` and `who_can_post` (#3722); kept so an open page from before the change gets a clear refusal. A value that would change who can see or post is refused with a reload message.';

export class CreateChannelDto {
  @ApiProperty()
  @IsString()
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  description?: string;

  @ApiProperty({
    enum: CHANNEL_TYPES,
    description:
      'PRIVATE for a channel its members decide (`member_ids`); PUBLIC otherwise. ROLE_GATED is still accepted and needs `who_can_see`; the API sets `type` from `who_can_see` either way.',
  })
  @IsIn(CHANNEL_TYPES)
  type: string;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description: WHO_CAN_SEE_DESCRIPTION,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_see?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description: WHO_CAN_POST_DESCRIPTION,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_post?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    deprecated: true,
    description: LEGACY_FIELD_DESCRIPTION,
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  required_permissions?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  category_id?: string;

  @ApiPropertyOptional({
    deprecated: true,
    description: LEGACY_FIELD_DESCRIPTION,
  })
  @IsOptional()
  @IsStrictBoolean()
  is_read_only?: boolean;

  // No `default:` in the schema: openapi-typescript reads a default as
  // required, which would make every existing create call send it. The
  // service still writes false when it is absent.
  @ApiPropertyOptional({
    description:
      'Always formal (#3787): every member sees the channel in the formal display and cannot pick another display there. False when absent. Change it later with PUT /v1/channels/{id}/display-lock.',
  })
  @IsOptional()
  @IsStrictBoolean()
  display_locked?: boolean;
}

/**
 * `PUT /v1/channels/:id/display-lock`. Its own route rather than a field on
 * `UpdateChannelDto`, because the channel's creator may set it without
 * `channels:manage`, which `PATCH /v1/channels/:id` requires.
 */
export class SetChannelDisplayLockDto {
  @ApiProperty({
    description:
      'True sets the channel to Always formal for every member; false lets each member pick their own display there again.',
  })
  @IsStrictBoolean()
  display_locked: boolean;
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

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description: WHO_CAN_SEE_DESCRIPTION,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_see?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description: WHO_CAN_POST_DESCRIPTION,
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_post?: string[] | null;

  @ApiPropertyOptional({
    description:
      "Copy both lists from the channel's category (the one it ends up in, when `category_id` moves it in the same request), so it matches the category again and follows its later changes. Refused with `who_can_see` or `who_can_post`, and on a channel with no category.",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsStrictBoolean()
  match_category_access?: boolean;

  @ApiPropertyOptional({
    type: [String],
    deprecated: true,
    description: LEGACY_FIELD_DESCRIPTION,
  })
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

  @ApiPropertyOptional({
    deprecated: true,
    description: LEGACY_FIELD_DESCRIPTION,
  })
  @IsOptional()
  @IsStrictBoolean()
  is_read_only?: boolean;

  // Nullable for the reason `category_id` is: `null` clears an officer's
  // choice and returns the channel to its built-in default, which has to be
  // expressible distinctly from "leave this field alone".
  @ApiPropertyOptional({
    enum: CHAT_NOTIFICATION_LEVELS,
    type: String,
    nullable: true,
    description:
      "The channel's default push level for members who have set none of their own (#2771). Null clears it back to the built-in default: `all` for #general and the announcements channel, `off` for #chapter-audit, `mentions` for the rest. A member's own channel or kind level always wins. Refused on a DM or group DM, which always default to `all`.",
  })
  @IsOptional()
  @IsIn(CHAT_NOTIFICATION_LEVELS)
  default_notification_level?: (typeof CHAT_NOTIFICATION_LEVELS)[number] | null;

  @ApiPropertyOptional({
    description:
      "Make this the chapter's default channel, where Chat opens for a member whose device has no last channel (ahead of #general). Setting it moves the default off any other channel; `false` on the current default leaves the chapter with none. Refused as `true` on a DM or group DM.",
  })
  // Not `@IsOptional()`, which lets `null` through to a not-null column (a
  // 500): absent skips validation, `null` is refused as not a boolean.
  @ValidateIf((_object, value) => value !== undefined)
  @IsStrictBoolean()
  is_default?: boolean;

  @ApiPropertyOptional({
    description:
      "Leave out of Activity (#3897): sign-up links posted here never reach anyone's Activity page, for channels like #advertising whose links aren't chapter business. Refused as `true` on a DM or group DM.",
  })
  @ValidateIf((_object, value) => value !== undefined)
  @IsStrictBoolean()
  activity_excluded?: boolean;
}

export class CreateDmDto {
  @ApiProperty({ description: 'The other member user ID' })
  @IsUUID()
  member_id: string;
}

/** `POST /v1/channels/{id}/members` (#1302): add a chapter member to a PRIVATE channel. */
export class AddChannelMemberDto {
  @ApiProperty({
    description:
      "The `users.id` to add. Must be a member of the channel's chapter.",
  })
  @IsUUID()
  user_id: string;
}

/** `GET /v1/channels/{id}/members` (#3536): one person who can read the channel. */
export class ChannelMemberDto {
  @ApiProperty({ format: 'uuid', description: "The member's `users.id`." })
  user_id: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      "The `display_order` of the member's highest role (lower ranks higher), or null when they hold no role. For sorting the list; names, avatars and role colors come from `GET /v1/members/roster`.",
  })
  role_rank: number | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'The id of that highest role, which the list groups readers under, or null when they hold no role.',
  })
  role_id: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "That role's name, the group's heading, or null when they hold no role.",
  })
  role_name: string | null;
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

  @ApiPropertyOptional({ default: 0, maximum: POSITION_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  display_order?: number;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description:
      'Who can see the channels that match this category (#3722): null for everyone in the chapter, or `tier:<id>` / `role:<id>` entries. A new channel in the category starts with it.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_see?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description:
      'Who can post in the channels that match this category: null for everyone who can see them, or `tier:<id>` / `role:<id>` entries.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_post?: string[] | null;
}

export class UpdateCategoryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ maximum: POSITION_MAX })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(POSITION_MAX)
  display_order?: number;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description:
      'Who can see the channels that match this category (#3722): null for everyone in the chapter, or `tier:<id>` / `role:<id>` entries. Changing it changes every channel in the category that matched it, and only those.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_see?: string[] | null;

  @ApiPropertyOptional({
    type: [String],
    nullable: true,
    maxItems: CHANNEL_ACCESS_LIST_MAX,
    description:
      'Who can post in the channels that match this category: null for everyone who can see them, or `tier:<id>` / `role:<id>` entries.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(CHANNEL_ACCESS_LIST_MAX)
  @IsString({ each: true })
  @Matches(CHANNEL_ACCESS_ENTRY_PATTERN, { each: true, message: ENTRY_MESSAGE })
  who_can_post?: string[] | null;
}

/**
 * One file the client uploaded to the `chat` bucket and is attaching.
 *
 * `storage_path` is validated for shape here and for OWNERSHIP in
 * `ChatAttachmentService.validateAttachmentInputs`, which re-checks it against the prefix
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

  @ApiPropertyOptional({
    description:
      'Photo width in pixels, so readers draw the bubble at its shape before the photo loads. A size out of range (1 to 20000), or one without the other, is dropped rather than refused, so a bad size never blocks a send.',
  })
  @IsOptional()
  @IsInt()
  width?: number;

  @ApiPropertyOptional({ description: 'Photo height in pixels; see `width`.' })
  @IsOptional()
  @IsInt()
  height?: number;

  @ApiPropertyOptional({
    maxLength: 64,
    description:
      'ThumbHash of the photo, base64: the blurred placeholder readers draw until it loads.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  thumbhash?: string;

  @ApiPropertyOptional({
    maxLength: 1024,
    description:
      'The `preview_storage_path` the upload-url call returned, once the preview copy is uploaded.',
  })
  @IsOptional()
  @IsString()
  @MaxLength(1024)
  preview_storage_path?: string;
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
   * Post inside this message's thread (#3785) rather than the timeline. The
   * root must be a timeline message in this channel, and a thread reply cannot
   * also carry `reply_to_id`. Authorizes as a thread write, which a read-only
   * channel allows (spec/behavior/chat/README.md § Message threads).
   */
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  thread_root_id?: string;

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

export class SetMessageFlagDto {
  @ApiProperty({
    enum: CHAT_MESSAGE_FLAGS,
    description:
      'One flag per message (#3921). Anyone who can read the channel may flag an unflagged message; replacing a flag takes its sender, whoever added it, or `channels:manage`.',
  })
  @IsIn(CHAT_MESSAGE_FLAGS)
  flag: ChatMessageFlag;
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
  // Omitted is "size unknown"; `null` is not a size. `@IsOptional` would
  // let it through to the ceiling check, which then called it too large (#2913).
  @ValidateIf((_object, value) => value !== undefined)
  @IsInt()
  @Min(0)
  size_bytes?: number;

  @ApiPropertyOptional({
    description:
      'Also mint an upload URL for a smaller JPEG copy of this photo, which readers draw in the timeline. Ignored unless content_type is an image.',
  })
  @IsOptional()
  @IsStrictBoolean()
  with_preview?: boolean;

  @ApiPropertyOptional({
    description:
      'The file is for a reply inside a message thread (#3785). Authorizes as a thread write, which a read-only channel allows, so mint and send agree for a thread reply under an announcement.',
  })
  @IsOptional()
  @IsStrictBoolean()
  for_thread?: boolean;
}

export class ChatUploadUrlResponseDto {
  @ApiProperty({
    description: 'Short-lived signed URL; PUT the bytes to it.',
  })
  upload_url: string;

  @ApiProperty({
    description:
      'Storage path to send back as the attachment path when posting the message.',
  })
  storage_path: string;

  @ApiProperty({
    description: 'Server-allocated message id embedded in storage_path.',
  })
  message_id: string;

  @ApiPropertyOptional({
    description:
      'Only when with_preview was asked for an image: PUT the preview JPEG here, as image/jpeg.',
  })
  preview_upload_url?: string;

  @ApiPropertyOptional({
    description:
      'Only with preview_upload_url: send back as the attachment preview_storage_path.',
  })
  preview_storage_path?: string;
}

/**
 * A chapter role as the caller's `@`-mention picker offers it (2026-11-06).
 * Membership is not sent: the picker needs the name to insert and whether the
 * caller may ping it, and the server expands the role when the message lands.
 */
export class MentionRoleDto {
  @ApiProperty({ format: 'uuid' })
  role_id: string;

  @ApiProperty({ description: 'The role name; the picker inserts it folded.' })
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'The role’s palette color, or null.',
  })
  color: string | null;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the caller may `@` this role: its own switch (`mentionable` on the role, on by default), or the caller holding `channels:manage` or `roles:manage`. A token naming a role the sender may not ping reaches nobody.',
  })
  mentionable: boolean;
}

/** `GET /v1/channels/access-options` (#3722): one thing a who-can-see or who-can-post list can name. */
export class ChannelAccessOptionDto {
  @ApiProperty({
    description:
      'The entry as a list stores it: `tier:<id>` or `role:<id>`. Send it back in `who_can_see` or `who_can_post`.',
  })
  entry: string;

  @ApiProperty({
    enum: ['tier', 'role'],
    description:
      'What the entry names. More kinds may come (groups, #4076); an editor groups by kind and should show an unknown one under its own heading.',
  })
  kind: string;

  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty()
  name: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "A role's palette color; null for a tier or an uncolored role.",
  })
  color: string | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description: "A role's tier, or null; always null for a tier.",
  })
  tier_id: string | null;

  @ApiProperty({
    type: [String],
    description:
      'The `users.id` of every member it names, so the editor can count who a list reaches without counting anyone twice.',
  })
  user_ids: string[];
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
 * `GET /v1/channels/latest`: one readable channel's latest message, for Chat
 * home's row preview. A channel with no message has no row.
 */
export class ChannelLatestMessageDto {
  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({ format: 'uuid' })
  message_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "The sender's `users.id`, or null for an imported archive message, which carries `author_name` instead.",
  })
  sender_id: string | null;

  @ApiProperty({ type: String, nullable: true })
  author_name: string | null;

  @ApiProperty({
    description:
      'The message body, cut to its first 500 characters. Empty for a card or a file-only message.',
  })
  content: string;

  @ApiProperty({
    description: 'The message kind (`text`, `event`, `system_audit`, ...).',
  })
  kind: string;

  @ApiProperty({
    type: 'object',
    additionalProperties: true,
    nullable: true,
    description:
      'The audit payload, set only when `kind` is `system_audit`; null for every other kind.',
  })
  payload: Record<string, unknown> | null;

  @ApiProperty({ type: Number })
  attachment_count: number;

  @ApiProperty({ format: 'date-time' })
  created_at: string;
}

/**
 * The three per-channel notification levels (ADR-06), mirroring the
 * `chat_notification_preferences.level` CHECK constraint.
 *
 * `off` is what the UI calls "muted". It is not absolute: `decidePush` lifts it
 * when the message mentions the recipient, which is the spec'd mention override
 * (`spec/behavior/notifications.md` § Per-Channel Mute). A channel's default
 * is not always `mentions`: officers can set one per channel, and without one
 * `#general` and the announcements channel default to `all` (#2771). So a
 * member's stored `mentions` is a real choice, not a reset to default.
 *
 * The same three values are the `chat_channels.default_notification_level`
 * CHECK constraint.
 *
 * Defined in `@repo/validation` beside `builtInChannelDefault`, and imported at
 * the top of this file: `UpdateChannelDto`'s decorator reads it before a local
 * `const` here would be initialized.
 */
export { CHAT_NOTIFICATION_LEVELS };

export class SetChannelNotificationLevelDto {
  @ApiProperty({
    enum: CHAT_NOTIFICATION_LEVELS,
    description:
      'all = every message; mentions = only when you are mentioned; off = muted, though @mentions still notify. With no level stored for the channel, a kind-level override applies (outside DMs), else the channel default (officer-set, else `all` for #general, the announcements channel and DMs, `off` for #chapter-audit, `mentions` for the rest); GET /v1/channels/notification-preferences reports it.',
  })
  @IsIn(CHAT_NOTIFICATION_LEVELS)
  level: (typeof CHAT_NOTIFICATION_LEVELS)[number];
}

export class ChannelNotificationPreferenceDto {
  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({ enum: CHAT_NOTIFICATION_LEVELS })
  level: (typeof CHAT_NOTIFICATION_LEVELS)[number];

  @ApiProperty({
    required: false,
    description:
      'True when the level comes from the member\'s chapter-wide chat level (GET /v1/channels/notification-preferences/chapter), not from this channel\'s own setting or default, so a client can label it "your default".',
  })
  from_chapter_level?: boolean;
}

export class SetChapterChatLevelDto {
  @ApiProperty({
    enum: CHAT_CHAPTER_LEVELS,
    description:
      'all = each channel at its own default; mentions = "Mentions and DMs only": every ordinary channel acts as mentions, while DMs, group DMs and the announcements channel keep notifying. A level the member set on one channel, or on a message kind, still wins.',
  })
  @IsIn(CHAT_CHAPTER_LEVELS)
  level: ChatChapterLevel;
}

export class ChapterChatLevelDto {
  @ApiProperty({ enum: CHAT_CHAPTER_LEVELS })
  level: ChatChapterLevel;
}

export class SetKindNotificationLevelDto {
  @ApiProperty({
    enum: CHAT_NOTIFICATION_LEVELS,
    description:
      'all = every message of this kind; mentions = only when you are mentioned; off = muted, though @mentions still notify — the one exception is the system_audit kind, whose off a mention does not lift. A channel-scoped preference outranks this one for messages in that channel. In a DM or group DM this applies only when it is louder than the DM default of all, so it cannot quiet a DM.',
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
      "The member's chapter-wide override for this kind, or null when they have set none. Null is not a level: what a kind falls back to depends on the channel a message lands in (the channel's own default: officer-set, else `all` in the announcements channel, #general and DMs, `mentions` elsewhere), so there is no single default to report here. For the effective level of a real message, read GET /v1/channels/notification-preferences.",
  })
  level: (typeof CHAT_NOTIFICATION_LEVELS)[number] | null;
}

/**
 * The DELETE response, separate from {@link KindNotificationPreferenceDto}
 * because its `kind` enum is genuinely wider. The clearer accepts any
 * `chat_messages.kind`, not just the settable subset, so that a row written
 * for a kind that has since become non-settable can still be removed; typing
 * the echo on the narrow enum would either be a lie or force the route to
 * refuse exactly the rows it exists to clean up.
 */
export class ClearedKindNotificationPreferenceDto {
  @ApiProperty({
    enum: CHAT_MESSAGE_KINDS,
    description:
      'The kind whose override was cleared. Wider than the settable set on purpose — see the DELETE route.',
  })
  kind: (typeof CHAT_MESSAGE_KINDS)[number];

  @ApiProperty({
    type: String,
    nullable: true,
    enum: CHAT_NOTIFICATION_LEVELS,
    description:
      'Always null: the override is gone, and what the kind now falls back to depends on the channel.',
  })
  level: null;
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
 * A chat message as a read surface serves it — the whole row, plus the
 * server's masking verdict for the caller.
 *
 * **Declared rather than inferred, and that is the point of it.** Neither
 * `GET /v1/channels/{id}/messages` nor `GET /v1/channels/{id}/pins` carried a
 * response schema, so `openapi.json` documented no 200 body and
 * `openapi-typescript` typed both responses `never` — the #1049 defect.
 * `sender_blocked` was therefore emitted by the API and invisible to every
 * typed client: the one machine-readable half of
 * `spec/behavior/chat/README.md` § The masking contract, unreachable.
 *
 * Mirrors {@link MaskedChatMessage} in `chat-block-mask.ts` field for field.
 * Nothing in this app serializes to a declared DTO — there is no
 * `ClassSerializerInterceptor` — so this class documents the wire shape and
 * does not enforce it; the service's return type is what keeps it true.
 */
export class ChatMessageDto {
  @ApiProperty({ format: 'uuid' })
  id: string;

  @ApiProperty({ format: 'uuid' })
  channel_id: string;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Null for an imported archive message, which names its author in author_name instead. Kept on a masked row: the blocker chose the block, so reading their own list back is not a disclosure — and without it a client cannot reconcile a server-masked row against the list it applies itself.',
  })
  sender_id: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  author_name?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  author_avatar_path?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  author_external_id?: string | null;

  @ApiProperty({
    type: String,
    description:
      'Reads the masking sentinel when `sender_blocked` is true, and “[message deleted]” once the message is deleted. **Never pattern-match either string** — the machine-readable signals are `sender_blocked` and `is_deleted`.',
  })
  content: string;

  @ApiProperty({ enum: ['TEXT', 'POLL'] })
  type: MessageType;

  @ApiProperty({
    enum: CHAT_MESSAGE_KINDS,
    nullable: true,
    required: false,
    description:
      "Null on rows written before the column existed; read as 'text'.",
  })
  kind?: (typeof CHAT_MESSAGE_KINDS)[number] | null;

  @ApiProperty({
    type: Object,
    nullable: true,
    required: false,
    description:
      'Inline card payload for rich kinds. Null on a masked row — a points / task / event card is authored by the acting member and interpolates their free text.',
  })
  payload?: Record<string, any> | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  client_message_id?: string | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  reply_to_id: string | null;

  @ApiProperty({
    type: Object,
    description:
      'Free-form annotations; carries `attachment_count`, and `attachment_photos` (one `{width, height, thumbhash}` per photo) so a reader can size each photo before the attachments read returns. Empty on a masked row, which is what stops a masked message pulling the blocked member’s uploads.',
  })
  metadata: Record<string, any>;

  @ApiProperty()
  is_pinned: boolean;

  @ApiProperty({ type: String, nullable: true })
  pinned_at: string | null;

  @ApiProperty({
    enum: CHAT_MESSAGE_FLAGS,
    nullable: true,
    required: false,
    description:
      'The flag a member added after the message was sent (#3921), or null. Null on a masked row: a tombstone draws no flag.',
  })
  flag?: ChatMessageFlag | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    required: false,
    description:
      'Who added the flag. Null when there is no flag, and also when the viewer blocked the member who added it: the flag stays, the name is withheld.',
  })
  flagged_by?: string | null;

  @ApiProperty({ type: String, nullable: true, required: false })
  flagged_at?: string | null;

  @ApiProperty({ type: String, nullable: true })
  edited_at: string | null;

  @ApiProperty()
  is_deleted: boolean;

  @ApiProperty({
    type: [String],
    nullable: true,
    required: false,
    description:
      "`users.id` of everyone mentioned, plus a reply's quoted author, resolved server-side at send time. Null on a masked row: a mention overrides a per-channel mute, so leaving it would let a blocked member keep poking the blocker through a masked row.",
  })
  mentions?: string[] | null;

  @ApiProperty({
    type: String,
    format: 'uuid',
    nullable: true,
    required: false,
    description:
      'The parent message when this row is a reply inside a message thread (#3785). Thread replies never appear in the channel timeline; a client that receives one over Realtime must keep it out of the timeline.',
  })
  thread_root_id?: string | null;

  @ApiProperty({
    type: Number,
    required: false,
    description:
      'On a thread parent: its reply count, kept by a trigger so the parent’s Realtime UPDATE echo carries it. 0 on every other row.',
  })
  thread_reply_count?: number;

  @ApiProperty({ type: String, nullable: true, required: false })
  thread_last_reply_at?: string | null;

  @ApiProperty({
    type: [String],
    required: false,
    description:
      'On a thread parent: up to three recent repliers, newest first.',
  })
  thread_recent_sender_ids?: string[];

  @ApiProperty()
  created_at: string;

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the server masked this row against the caller’s block list. Present on **every** row, not only the masked ones: an absent-means-false flag cannot distinguish “this server does not mask” from “this message is fine”. Not sufficient on its own — rows arriving over the Realtime `postgres_changes` echo carry no viewer, so a client must also apply the list from `GET /v1/chat/blocks`.',
  })
  sender_blocked: boolean;
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

  @ApiProperty({
    type: Boolean,
    description:
      'Whether the caller has blocked this message’s sender. Present on every row, not only the masked ones. A blocked row’s `content` reads the masking sentinel — never pattern-match it. Distinct from `message_available`, which is about channel access: a block leaves the jump affordance live, and it lands on the same tombstone the timeline shows.',
  })
  sender_blocked: boolean;
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

export class GetChannelMessagesQueryDto {
  @ApiPropertyOptional({
    description:
      'Max messages to return. Integers outside 1–200 are rejected; omitted defaults to 50 after clamp.',
    minimum: LIST_QUERY_LIMIT_MIN,
    maximum: LIST_QUERY_LIMIT_MAX,
    default: LIST_QUERY_LIMIT_DEFAULT,
    example: LIST_QUERY_LIMIT_DEFAULT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(LIST_QUERY_LIMIT_MIN)
  @Max(LIST_QUERY_LIMIT_MAX)
  limit?: number;

  @ApiPropertyOptional({
    description:
      'Cursor — return messages created strictly before this timestamp. Full ISO 8601 with an explicit UTC offset; feed back the `created_at` of the oldest row you received.',
    example: '2026-01-31T23:59:59.999Z',
    pattern: ISO_INSTANT_PATTERN,
  })
  @IsOptional()
  @Matches(ISO_INSTANT_REGEX, { message: `$property ${ISO_INSTANT_MESSAGE}` })
  before?: string;

  @ApiPropertyOptional({
    description:
      'Message UUID — returns messages created after this message (reconnect replay). Still newest first under `limit`: the page is the newest `limit` messages after this one, so a full page may not reach back to it. 404 with code `chat.since_not_found` when no message in this channel has this id.',
    format: 'uuid',
  })
  @IsOptional()
  // Reaches `.eq('id', …)` on a uuid column; an unvalidated string fails in
  // Postgres as a 500 rather than here as a 400.
  @IsUUID()
  since?: string;
}

/** `GET /v1/channels/:id/threads/:rootId`: a thread's parent and the caller's follow. */
export class ChatThreadDto {
  @ApiProperty({ type: () => ChatMessageDto })
  root: ChatMessageDto;

  @ApiProperty({
    enum: CHAT_THREAD_FOLLOW_STATES,
    nullable: true,
    description: 'The caller’s state; null when not following.',
  })
  follow_state: ChatThreadFollowState | null;

  @ApiProperty({ type: String, nullable: true })
  last_read_at: string | null;
}

/** `PUT /v1/channels/:id/threads/:rootId/follow`. */
export class SetThreadFollowDto {
  @ApiProperty({
    enum: [...CHAT_THREAD_FOLLOW_STATES, 'none'],
    description:
      '`following` pushes replies within the channel’s level, `muted` never pushes, `none` unfollows.',
  })
  @IsIn([...CHAT_THREAD_FOLLOW_STATES, 'none'])
  state: ChatThreadFollowState | 'none';
}

/** What a follow change answers. */
export class ThreadFollowStateDto {
  @ApiProperty({ enum: CHAT_THREAD_FOLLOW_STATES, nullable: true })
  follow_state: ChatThreadFollowState | null;
}

/** What marking a thread read answers. */
export class ThreadReadDto {
  @ApiProperty()
  last_read_at: string;
}

/** One followed or muted thread in a channel, for the Threads button and the parent's chip. */
export class FollowedThreadDto {
  @ApiProperty({ format: 'uuid' })
  thread_root_id: string;

  @ApiProperty({ enum: CHAT_THREAD_FOLLOW_STATES })
  state: ChatThreadFollowState;

  @ApiProperty({ type: String, nullable: true })
  last_read_at: string | null;

  @ApiProperty({
    description: 'Replies new to the caller; always 0 when muted.',
  })
  unread_count: number;
}
