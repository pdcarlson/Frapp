import {
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  ChatMessageAction,
  ChatMessageAttachment,
  MessageReaction,
  ChannelReadReceipt,
  ChannelUnreadCount,
  ChatMessageBookmarkRef,
  ChatMessageBookmarkWithMessage,
} from '../entities/chat.entity';

export const CHAT_CHANNEL_REPOSITORY = 'CHAT_CHANNEL_REPOSITORY';
export const CHAT_CATEGORY_REPOSITORY = 'CHAT_CATEGORY_REPOSITORY';
export const CHAT_MESSAGE_REPOSITORY = 'CHAT_MESSAGE_REPOSITORY';
export const CHAT_MESSAGE_ACTION_REPOSITORY = 'CHAT_MESSAGE_ACTION_REPOSITORY';
export const CHAT_MESSAGE_ATTACHMENT_REPOSITORY =
  'CHAT_MESSAGE_ATTACHMENT_REPOSITORY';
export const MESSAGE_REACTION_REPOSITORY = 'MESSAGE_REACTION_REPOSITORY';
export const CHANNEL_READ_RECEIPT_REPOSITORY =
  'CHANNEL_READ_RECEIPT_REPOSITORY';
export const CHAT_MESSAGE_BOOKMARK_REPOSITORY =
  'CHAT_MESSAGE_BOOKMARK_REPOSITORY';

/** Postgres unique-violation error code. */
export const PG_UNIQUE_VIOLATION = '23505';

/**
 * Thrown by `IChatMessageRepository.create` when the partial unique index
 * `idx_chat_messages_dedupe` rejects the insert. Callers should re-select
 * the existing row via `findByClientMessageId` and return it as
 * `deduplicated: true`.
 */
export class ChatMessageDuplicateError extends Error {
  constructor(
    public readonly channel_id: string,
    public readonly sender_id: string | null,
    public readonly client_message_id: string,
  ) {
    super('Duplicate chat_messages insert (client_message_id collision)');
    this.name = 'ChatMessageDuplicateError';
  }
}

/**
 * Thrown by `IChatMessageActionRepository.create` when the unique dedupe
 * index `idx_chat_message_actions_dedupe` rejects the insert. Callers
 * decide whether to UPSERT (vote-change) or surface the existing row
 * as a no-op dedup.
 */
export class ChatMessageActionDuplicateError extends Error {
  constructor(
    public readonly message_id: string,
    public readonly user_id: string,
    public readonly action_type: string,
  ) {
    super('Duplicate chat_message_actions insert');
    this.name = 'ChatMessageActionDuplicateError';
  }
}

export interface IChatChannelRepository {
  findById(id: string, chapterId: string): Promise<ChatChannel | null>;
  findByChapter(chapterId: string): Promise<ChatChannel[]>;
  findDm(chapterId: string, memberIds: string[]): Promise<ChatChannel | null>;
  create(data: Partial<ChatChannel>): Promise<ChatChannel>;
  update(
    id: string,
    chapterId: string,
    data: Partial<ChatChannel>,
  ): Promise<ChatChannel>;
  delete(id: string, chapterId: string): Promise<void>;
  /** Atomic Group DM leave (#348) — see the Supabase implementation's doc comment. */
  leaveGroupDm(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel | null>;
}

export interface IChatCategoryRepository {
  findByChapter(chapterId: string): Promise<ChatChannelCategory[]>;
  findById(id: string, chapterId: string): Promise<ChatChannelCategory | null>;
  create(data: Partial<ChatChannelCategory>): Promise<ChatChannelCategory>;
  update(
    id: string,
    chapterId: string,
    data: Partial<ChatChannelCategory>,
  ): Promise<ChatChannelCategory>;
  delete(id: string, chapterId: string): Promise<void>;
}

export interface IChatMessageRepository {
  findById(id: string): Promise<ChatMessage | null>;
  findByChannel(
    channelId: string,
    options?: { limit?: number; before?: string },
  ): Promise<ChatMessage[]>;
  findPinnedByChannel(channelId: string): Promise<ChatMessage[]>;
  countPinnedByChannel(channelId: string): Promise<number>;
  /**
   * Newest-first list of POLL messages across every channel in the chapter.
   * Optional `channelId` scopes to a single channel. `limit` caps result size
   * (undefined, non-finite, or non-positive values use the shared list default;
   * finite positive values are clamped to the shared list min/max in the repo).
   * When `active` is set, closure is enforced in SQL (via `metadata.expires_at`
   * and `metadata.closed_at` — a poll is inactive once either fires, #379)
   * so `limit` applies after that filter, not before.
   */
  findPollsByChapter(
    chapterId: string,
    options?: { channelId?: string; limit?: number; active?: boolean },
  ): Promise<ChatMessage[]>;
  /**
   * Locate an already-persisted message by its idempotency triple. Used by
   * the hot-path send to reconcile a duplicate `(channel_id, sender_id,
   * client_message_id)` insert. Returns null when no such row exists.
   */
  findByClientMessageId(
    channelId: string,
    senderId: string | null,
    clientMessageId: string,
  ): Promise<ChatMessage | null>;
  /**
   * Distinct, non-null `author_avatar_path` values among the given message
   * ids — scoped to `channelId` in the same statement as the lookup, so a
   * message id from another channel contributes nothing rather than relying
   * on the caller having checked first (#1231).
   *
   * This is the ONLY legitimate source of an avatar path for
   * `ChatService.resolveAuthorAvatars`: avatars and message attachments are
   * both written under the same undifferentiated `chat-archive` object
   * layout (`archiveMediaObjectPath` — no `authors/`-vs-`attachments/`
   * distinction exists in the path shape), so a caller-supplied raw path
   * cannot be trusted to actually be an avatar rather than some other
   * message's attachment. Deriving the path set from messages the caller
   * was already proven to have channel access to is what keeps this from
   * being a way to read arbitrary chat-archive objects.
   */
  findAuthorAvatarPaths(
    channelId: string,
    messageIds: string[],
  ): Promise<string[]>;
  /**
   * Insert a row. Throws {@link ChatMessageDuplicateError} on a
   * `(channel_id, sender_id, client_message_id)` unique violation so the
   * service can re-select and surface it as `deduplicated: true` instead
   * of a 5xx.
   */
  create(data: Partial<ChatMessage>): Promise<ChatMessage>;
  update(id: string, data: Partial<ChatMessage>): Promise<ChatMessage>;
}

export interface IChatMessageActionRepository {
  /**
   * Insert a per-user reaction / vote / RSVP row. Throws
   * {@link ChatMessageActionDuplicateError} on the unique index violation
   * so the caller can decide between dedup-as-success (emoji reactions)
   * and UPSERT (vote-change, ADR-07) without a read-then-insert race.
   */
  create(data: {
    message_id: string;
    user_id: string;
    action_type: string;
    payload?: Record<string, unknown>;
  }): Promise<ChatMessageAction>;
  findOne(
    messageId: string,
    userId: string,
    actionType: string,
  ): Promise<ChatMessageAction | null>;
  /**
   * Vote-change UPSERT (ADR-07): overwrite `payload` + bump `created_at`
   * on the row keyed by (message_id, user_id, action_type). The row id
   * stays stable so a subscribed client matches the Realtime UPDATE.
   */
  updateForVote(
    messageId: string,
    userId: string,
    actionType: string,
    payload: Record<string, unknown>,
  ): Promise<ChatMessageAction | null>;
}

export interface IMessageReactionRepository {
  findByMessage(messageId: string): Promise<MessageReaction[]>;
  findOne(
    messageId: string,
    userId: string,
    emoji: string,
  ): Promise<MessageReaction | null>;
  create(data: Partial<MessageReaction>): Promise<MessageReaction>;
  delete(messageId: string, userId: string, emoji: string): Promise<void>;
}

export interface IChannelReadReceiptRepository {
  upsert(
    channelId: string,
    userId: string,
    lastReadAt: string,
  ): Promise<ChannelReadReceipt>;
  /**
   * Unread and mention tallies for every channel in a chapter, for one viewer.
   *
   * Returns a row per channel **including ones the viewer cannot access**, so
   * the caller must filter. Kept that way deliberately: the access predicate
   * lives in `ChannelAccessService` and a second copy inside the SQL would be
   * free to drift from it.
   */
  getUnreadCounts(
    chapterId: string,
    userId: string,
  ): Promise<ChannelUnreadCount[]>;
}

/**
 * Personal message bookmarks (#462).
 *
 * **Every method takes `userId` and every query filters on it.** There is no
 * "find by message" or "count for message" here, deliberately: the spec says no
 * one — not even a channel admin — can see who bookmarked what, so a repository
 * method that answers a question about *other* people's bookmarks is a
 * capability this feature must not own. Adding one later is the change that
 * would quietly make the privacy claim false, so its absence is the design.
 */
export interface IChatMessageBookmarkRepository {
  /**
   * Idempotent create. Returns the existing row on a repeat rather than
   * raising `PG_UNIQUE_VIOLATION`, so a double-tap or an offline retry is a
   * no-op instead of an error the client has to special-case.
   */
  create(
    userId: string,
    messageId: string,
    chapterId: string,
  ): Promise<ChatMessageBookmarkRef>;
  /**
   * Removes the caller's own bookmark. A no-op when there wasn't one.
   *
   * Takes `chapterId` even though `(user_id, message_id)` is already globally
   * unique. That redundancy is the point: without it the method's safety would
   * rest entirely on its caller, and the signature would give no hint that a
   * chapter was ever involved.
   */
  delete(userId: string, messageId: string, chapterId: string): Promise<void>;
  /**
   * The caller's bookmarks in one chapter, newest first, each joined to its
   * message.
   *
   * Does **not** filter `is_deleted`: a bookmark whose message was deleted must
   * still appear, carrying the message's own `[message deleted]` content as the
   * placeholder the spec requires.
   */
  findByUserAndChapter(
    userId: string,
    chapterId: string,
  ): Promise<ChatMessageBookmarkWithMessage[]>;
}

/**
 * The fields an attachment is created with.
 *
 * Spelled out rather than `Partial<ChatMessageAttachment>` — matching
 * `IChatMessageActionRepository.create` — because every one of these is required
 * at insert time and a `Partial` would let a caller omit `channel_id`, which is
 * what carries the row's tenant scope.
 */
export interface NewChatMessageAttachment {
  message_id: string;
  channel_id: string;
  bucket: string;
  storage_path: string;
  filename: string;
  content_type: string | null;
  byte_size: number | null;
  width?: number | null;
  height?: number | null;
  external_url?: string | null;
}

/**
 * Attachment rows for chat messages.
 *
 * Deliberately narrow: attachments are written once with their message and read
 * back per message. There is no update method because there is nothing to
 * update — an attachment is an immutable fact about a message — and no delete
 * because `ON DELETE CASCADE` from `chat_messages` already removes them, which
 * is the only way one should ever disappear.
 */
export interface IChatMessageAttachmentRepository {
  /** Bulk-insert the attachments for one message. Returns the created rows. */
  createMany(
    rows: NewChatMessageAttachment[],
  ): Promise<ChatMessageAttachment[]>;

  /**
   * Attachments for one message, oldest first (the order they were attached).
   *
   * `chapterId` is not redundant with `messageId`: the tenant predicate belongs
   * in the same statement as the lookup, so a message id from another chapter
   * returns nothing rather than relying on the caller having checked first
   * (spec/behavior/multi-tenancy.md — scope the query, don't read-then-check).
   */
  findByMessage(
    messageId: string,
    chapterId: string,
  ): Promise<ChatMessageAttachment[]>;

  /**
   * Which of `candidates` some message *other than* `excludingMessageId` still
   * references.
   *
   * Exists so deleting a message can purge its Storage objects without
   * destroying another message's. The unique constraint on this table is
   * `(message_id, bucket, storage_path)` — per message, not per object — and
   * the Discord importer deliberately maps every reference to a deduplicated
   * export file onto the *same* object (`domain/utils/discord-export.ts`), so
   * two messages sharing one object is a supported state, not a corruption.
   *
   * Only **undeleted** messages count. Soft delete leaves these rows in place,
   * so counting them would let two deleted messages spare each other's shared
   * object forever — a leak dressed as a guard.
   *
   * Deliberately **not** chapter-scoped, unlike `findByMessage`: a scoped
   * answer could only ever be falsely negative, and that is the direction that
   * deletes a live file. It returns no tenant data — the caller supplied every
   * path it can get back.
   *
   * **Scope limit, stated because the name overreaches:** this answers
   * "does another chat *message attachment* still point at these bytes", not
   * "does anything anywhere". `chat_messages.author_avatar_path` and
   * `discord_import_files.storage_path` can resolve to the same imported
   * object, and neither is consulted — see #1623.
   */
  findSharedObjects(
    candidates: readonly { bucket: string; storage_path: string }[],
    excludingMessageId: string,
  ): Promise<{ bucket: string; storage_path: string }[]>;
}
