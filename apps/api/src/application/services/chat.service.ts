import * as path from 'path';
import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHAT_MESSAGE_ACTION_REPOSITORY,
  MESSAGE_REACTION_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
  ChatMessageDuplicateError,
  ChatMessageActionDuplicateError,
} from '../../domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatCategoryRepository,
  IChatMessageRepository,
  IChatMessageActionRepository,
  IMessageReactionRepository,
  IChannelReadReceiptRepository,
} from '../../domain/repositories/chat.repository.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import type {
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  ChatMessageAction,
  ChatMessageKind,
  ChannelType,
} from '../../domain/entities/chat.entity';
import { NotificationService } from './notification.service';
import { ChannelAccessService } from './channel-access.service';

const MAX_PINNED_MESSAGES = 50;
const MAX_GROUP_DM_MEMBERS = 10;
const CHAT_BUCKET = 'chat';

// A ROLE_GATED channel that gates on nothing is denied by `canAccessChannel`
// (FRA-321), so reject the shape at the write points rather than letting a
// chapter create a channel nobody but the President can open.
const ROLE_GATED_REQUIRES_PERMISSIONS_MESSAGE =
  'A ROLE_GATED channel must specify at least one entry in required_permissions';

const ALLOWED_CONTENT_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/msword',
  'application/vnd.ms-excel',
  'application/vnd.ms-powerpoint',
  'text/plain',
  'text/csv',
]);

const ALLOWED_EXTENSIONS = new Set([
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.pdf',
  '.docx',
  '.xlsx',
  '.pptx',
  '.doc',
  '.xls',
  '.ppt',
  '.txt',
  '.csv',
]);

export interface CreateChannelInput {
  chapter_id: string;
  name: string;
  description?: string | null;
  type: ChannelType;
  required_permissions?: string[] | null;
  category_id?: string | null;
  is_read_only?: boolean;
}

export interface CreateDmInput {
  chapter_id: string;
  member_ids: string[];
}

export interface SendMessageInput {
  chapter_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  /** Client-generated idempotency key; reused on retry. */
  client_message_id?: string | null;
  /** Extended hot-path kind (Chunk 02); defaults to `text` when absent. */
  kind?: ChatMessageKind | null;
  /** Inline card payload for rich kinds. */
  payload?: Record<string, any> | null;
  reply_to_id?: string | null;
  metadata?: Record<string, any>;
  /**
   * Internal-only: set by trusted server callers (e.g. `PointsService` posting
   * a `points` card after a committed ledger write) to bypass the
   * server-originated-kind guard. Never present on `SendMessageDto`, so a
   * client request can never set it.
   */
  system_originated?: boolean;
}

/**
 * Kinds that assert a server-side side effect (a ledger write, a created task
 * or event, an audit row). A client must never post these directly — only a
 * trusted server caller may, via `SendMessageInput.system_originated`. `loading`
 * stays client-postable: it is the optimistic placeholder for the heavy-command
 * pattern.
 */
const SERVER_ONLY_KINDS: ReadonlySet<ChatMessageKind> = new Set([
  'event',
  'points',
  'task',
  'system_audit',
]);

/** Vote action UPSERTS rather than duplicates (ADR-07). */
const VOTE_ACTION_TYPE = 'vote';
/**
 * Realtime topic the web client subscribes to per channel. Matches the
 * topic used by the retired `chat-send` Edge Function so subscribed
 * clients pick up `new_message` broadcasts without any wire change.
 */
function realtimeTopicForChannel(channelId: string): string {
  return `chapter:${channelId}`;
}

export interface CreateCategoryInput {
  chapter_id: string;
  name: string;
  display_order?: number;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_CATEGORY_REPOSITORY)
    private readonly categoryRepo: IChatCategoryRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHAT_MESSAGE_ACTION_REPOSITORY)
    private readonly actionRepo: IChatMessageActionRepository,
    @Inject(MESSAGE_REACTION_REPOSITORY)
    private readonly reactionRepo: IMessageReactionRepository,
    @Inject(CHANNEL_READ_RECEIPT_REPOSITORY)
    private readonly readReceiptRepo: IChannelReadReceiptRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
    private readonly notificationService: NotificationService,
    private readonly channelAccess: ChannelAccessService,
  ) {}

  // ── Channels ─────────────────────────────────────────────────────────

  async getChannels(chapterId: string): Promise<ChatChannel[]> {
    return this.channelRepo.findByChapter(chapterId);
  }

  async getChannel(id: string, chapterId: string): Promise<ChatChannel> {
    const channel = await this.channelRepo.findById(id, chapterId);
    if (!channel) throw new NotFoundException('Channel not found');
    return channel;
  }

  async createChannel(input: CreateChannelInput): Promise<ChatChannel> {
    if (input.type === 'DM' || input.type === 'GROUP_DM') {
      throw new BadRequestException(
        'Use the DM endpoint to create direct messages',
      );
    }

    if (
      input.type === 'ROLE_GATED' &&
      (input.required_permissions ?? []).length === 0
    ) {
      throw new BadRequestException(ROLE_GATED_REQUIRES_PERMISSIONS_MESSAGE);
    }

    return this.channelRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      description: input.description ?? null,
      type: input.type,
      required_permissions: input.required_permissions ?? null,
      category_id: input.category_id ?? null,
      is_read_only: input.is_read_only ?? false,
    });
  }

  async updateChannel(
    id: string,
    chapterId: string,
    data: Partial<
      Pick<
        ChatChannel,
        | 'name'
        | 'description'
        | 'required_permissions'
        | 'category_id'
        | 'is_read_only'
      >
    >,
  ): Promise<ChatChannel> {
    const existing = await this.getChannel(id, chapterId);

    // `type` is not updatable, so the existing row decides whether the gate
    // applies. Only guard when the caller actually sends the field — omitting it
    // leaves the stored list intact.
    if (
      existing.type === 'ROLE_GATED' &&
      data.required_permissions !== undefined &&
      (data.required_permissions ?? []).length === 0
    ) {
      throw new BadRequestException(ROLE_GATED_REQUIRES_PERMISSIONS_MESSAGE);
    }

    return this.channelRepo.update(id, chapterId, data);
  }

  async deleteChannel(id: string, chapterId: string): Promise<void> {
    await this.getChannel(id, chapterId);
    await this.channelRepo.delete(id, chapterId);
  }

  async getOrCreateDm(input: CreateDmInput): Promise<ChatChannel> {
    if (input.member_ids.length !== 2) {
      throw new BadRequestException('A DM requires exactly 2 members');
    }

    const existing = await this.channelRepo.findDm(
      input.chapter_id,
      input.member_ids,
    );
    if (existing) return existing;

    const sorted = [...input.member_ids].sort();
    return this.channelRepo.create({
      chapter_id: input.chapter_id,
      name: `dm-${sorted.join('-')}`,
      type: 'DM',
      member_ids: sorted,
    });
  }

  async createGroupDm(
    chapterId: string,
    memberIds: string[],
    name?: string,
  ): Promise<ChatChannel> {
    if (memberIds.length < 2 || memberIds.length > MAX_GROUP_DM_MEMBERS) {
      throw new BadRequestException(
        `Group DMs require 2 to ${MAX_GROUP_DM_MEMBERS} members`,
      );
    }

    return this.channelRepo.create({
      chapter_id: chapterId,
      name: name ?? `group-dm-${Date.now()}`,
      type: 'GROUP_DM',
      member_ids: memberIds,
    });
  }

  // ── Categories ───────────────────────────────────────────────────────

  async getCategories(chapterId: string): Promise<ChatChannelCategory[]> {
    return this.categoryRepo.findByChapter(chapterId);
  }

  async createCategory(
    input: CreateCategoryInput,
  ): Promise<ChatChannelCategory> {
    return this.categoryRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      display_order: input.display_order ?? 0,
    });
  }

  /**
   * Categories are chapter-scoped, so a caller holding `channels:manage` in
   * their own chapter must not be able to reach another chapter's category by
   * UUID. Mirrors the channel pattern: resolve within the active chapter first
   * (404 when it does not belong there), then mutate through a chapter-scoped
   * repository call so the filter is enforced at the query too.
   */
  async getCategory(
    id: string,
    chapterId: string,
  ): Promise<ChatChannelCategory> {
    const category = await this.categoryRepo.findById(id, chapterId);
    if (!category) throw new NotFoundException('Category not found');
    return category;
  }

  async updateCategory(
    id: string,
    chapterId: string,
    data: { name?: string; display_order?: number },
  ): Promise<ChatChannelCategory> {
    await this.getCategory(id, chapterId);
    return this.categoryRepo.update(id, chapterId, data);
  }

  async deleteCategory(id: string, chapterId: string): Promise<void> {
    await this.getCategory(id, chapterId);
    await this.categoryRepo.delete(id, chapterId);
  }

  // ── Messages ─────────────────────────────────────────────────────────

  async getMessages(
    channelId: string,
    chapterId: string,
    userId: string,
    options?: { limit?: number; before?: string; since?: string },
  ): Promise<ChatMessage[]> {
    await this.assertChannelAccess(channelId, chapterId, userId);
    return this.messageRepo.findByChannel(channelId, options);
  }

  /**
   * Hot-path send. Mirrors the retired `chat-send` Edge Function:
   *
   * - Authorizes via the shared `canAccessChannel` predicate with
   *   `operation: "post"` so read-only channels (#announcements,
   *   #chapter-audit) gate on the `announcements:post` permission.
   * - Cross-channel reply links are rejected before the insert.
   * - Idempotent on `client_message_id`: a retried POST with the same
   *   `(channel_id, sender_id, client_message_id)` triple returns the
   *   existing row with `deduplicated: true` instead of inserting again
   *   (partial unique index `idx_chat_messages_dedupe`).
   * - Best-effort Realtime broadcast on the channel topic so subscribed
   *   clients see new messages without waiting for Postgres Changes; the
   *   broadcast failure never fails the request because Postgres Changes
   *   is the source of truth.
   */
  async sendMessage(
    input: SendMessageInput,
  ): Promise<{ message: ChatMessage; deduplicated: boolean }> {
    if (!input.content.trim()) {
      throw new BadRequestException('Message content cannot be empty');
    }

    if (
      input.kind &&
      SERVER_ONLY_KINDS.has(input.kind) &&
      input.system_originated !== true
    ) {
      throw new ForbiddenException(
        `Messages of kind "${input.kind}" are server-originated and cannot be posted directly`,
      );
    }

    const channel = await this.assertChannelAccess(
      input.channel_id,
      input.chapter_id,
      input.sender_id,
      'post',
    );

    if (input.reply_to_id) {
      const replyTo = await this.messageRepo.findById(input.reply_to_id);
      if (!replyTo || replyTo.channel_id !== input.channel_id) {
        throw new BadRequestException(
          'reply_to_id must reference a message in the same channel',
        );
      }
    }

    const kind: ChatMessageKind = input.kind ?? 'text';

    let message: ChatMessage;
    const deduplicated = false;
    try {
      message = await this.messageRepo.create({
        channel_id: input.channel_id,
        sender_id: input.sender_id,
        content: input.content,
        type: 'TEXT',
        kind,
        payload: input.payload ?? null,
        client_message_id: input.client_message_id ?? null,
        reply_to_id: input.reply_to_id ?? null,
        metadata: input.metadata ?? {},
      });
    } catch (error) {
      if (
        error instanceof ChatMessageDuplicateError &&
        input.client_message_id
      ) {
        const existing = await this.messageRepo.findByClientMessageId(
          input.channel_id,
          input.sender_id,
          input.client_message_id,
        );
        if (!existing) {
          throw error;
        }
        return { message: existing, deduplicated: true };
      }
      throw error;
    }

    try {
      await this.sendMessageNotification(input, channel);
    } catch (error) {
      this.logger.warn('Failed to send message notification', {
        messageId: message.id,
        channelId: input.channel_id,
        chapterId: input.chapter_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    await this.broadcastNewMessage(message);

    return { message, deduplicated };
  }

  /**
   * Emit a Realtime broadcast on the channel topic. Mirrors the retired
   * Edge Function: best-effort — a broadcast failure is logged and
   * swallowed because Postgres Changes is the authoritative source.
   */
  private async broadcastNewMessage(message: ChatMessage): Promise<void> {
    try {
      const channel = this.supabase.channel(
        realtimeTopicForChannel(message.channel_id),
      );
      await channel.send({
        type: 'broadcast',
        event: 'new_message',
        payload: message,
      });
      await this.supabase.removeChannel(channel);
    } catch (error) {
      this.logger.debug('chat broadcast failed (Postgres Changes will catch)', {
        messageId: message.id,
        channelId: message.channel_id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async sendMessageNotification(
    input: SendMessageInput,
    channel: ChatChannel,
  ): Promise<void> {
    const isAnnouncement = channel.name.toLowerCase().includes('announcements');

    if (isAnnouncement) {
      await this.notificationService.notifyChapter(channel.chapter_id, {
        title: 'New Announcement',
        body: input.content.slice(0, 200),
        priority: 'URGENT',
        category: 'announcements',
        data: { target: { screen: 'chat', channelId: channel.id } },
      });
    } else if (channel.type === 'DM' || channel.type === 'GROUP_DM') {
      const recipientIds = (channel.member_ids ?? []).filter(
        (id) => id !== input.sender_id,
      );
      await Promise.allSettled(
        recipientIds.map((recipientId) =>
          this.notificationService.notifyUser(recipientId, channel.chapter_id, {
            title: 'New Message',
            body: input.content.slice(0, 200),
            priority: 'NORMAL',
            category: 'chat',
            data: { target: { screen: 'chat', channelId: channel.id } },
          }),
        ),
      );
    }
  }

  /**
   * Authorize a caller for a channel from a TRUSTED DB lookup
   * (channel → chapter → membership), never client-supplied chapter fields.
   *
   * Delegates to the shared {@link ChannelAccessService} so the chat and poll
   * surfaces enforce channel visibility (PUBLIC / PRIVATE / ROLE_GATED / DM)
   * through one code path and cannot drift.
   */
  private assertChannelAccess(
    channelId: string,
    chapterId: string,
    userId: string,
    operation: 'read' | 'post' = 'read',
  ): Promise<ChatChannel> {
    return this.channelAccess.assertChannelAccess(
      channelId,
      chapterId,
      userId,
      operation,
    );
  }

  /**
   * Authorize a caller for a message by resolving message → channel → chapter,
   * then delegating to {@link assertChannelAccess}. A message in a channel the
   * caller cannot see (or in another chapter) is rejected.
   *
   * `operation` defaults to `'read'`, which is right for actions that don't
   * author channel content (delete, pin, react, vote). Pass `'post'` for
   * anything that writes member-authored content into the channel — otherwise
   * the post-side gates (read-only channels, the Alumni lifecycle rule) are
   * bypassed by editing an existing message instead of sending a new one.
   */
  private async assertMessageAccess(
    messageId: string,
    chapterId: string,
    userId: string,
    operation: 'read' | 'post' = 'read',
  ): Promise<ChatMessage> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');
    try {
      await this.assertChannelAccess(
        message.channel_id,
        chapterId,
        userId,
        operation,
      );
    } catch (error) {
      // A message whose channel is in another chapter surfaces as a
      // channel-level 404 — normalize it so callers cannot distinguish
      // "message missing" from "message in a chapter you can't see".
      if (error instanceof NotFoundException) {
        throw new NotFoundException('Message not found');
      }
      throw error;
    }
    return message;
  }

  async editMessage(
    messageId: string,
    chapterId: string,
    senderId: string,
    content: string,
  ): Promise<ChatMessage> {
    // Ownership alone is not enough: a member removed from another chapter
    // would still pass the sender check on their historical messages there.
    // Authorized as a "post" — an edit writes new member-authored content into
    // the channel, so it must clear the same gates as sending. Otherwise an
    // alumnus (or a member in a read-only channel) could rewrite an older
    // message of theirs to arbitrary text and broadcast it.
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      senderId,
      'post',
    );

    if (message.sender_id !== senderId) {
      throw new ForbiddenException('You can only edit your own messages');
    }

    if (message.is_deleted) {
      throw new BadRequestException('Cannot edit a deleted message');
    }

    return this.messageRepo.update(messageId, {
      content,
      edited_at: new Date().toISOString(),
    });
  }

  async deleteMessage(
    messageId: string,
    chapterId: string,
    requesterId: string,
    hasManagePermission: boolean,
  ): Promise<ChatMessage> {
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      requesterId,
    );

    if (message.sender_id !== requesterId && !hasManagePermission) {
      throw new ForbiddenException(
        'You can only delete your own messages unless you have channels:manage permission',
      );
    }

    return this.messageRepo.update(messageId, {
      content: '[message deleted]',
      is_deleted: true,
      metadata: {},
    });
  }

  // ── Pins ─────────────────────────────────────────────────────────────

  async pinMessage(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatMessage> {
    // Pin/unpin are moderation controls: `channels:manage` in the caller's own
    // chapter must not reach a message in someone else's.
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );

    if (message.is_pinned) {
      throw new BadRequestException('Message is already pinned');
    }

    const pinnedCount = await this.messageRepo.countPinnedByChannel(
      message.channel_id,
    );
    if (pinnedCount >= MAX_PINNED_MESSAGES) {
      throw new BadRequestException(
        `Maximum of ${MAX_PINNED_MESSAGES} pinned messages per channel. Unpin an older message first.`,
      );
    }

    return this.messageRepo.update(messageId, {
      is_pinned: true,
      pinned_at: new Date().toISOString(),
    });
  }

  async unpinMessage(
    messageId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatMessage> {
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );

    if (!message.is_pinned) {
      throw new BadRequestException('Message is not pinned');
    }

    return this.messageRepo.update(messageId, {
      is_pinned: false,
      pinned_at: null,
    });
  }

  async getPinnedMessages(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatMessage[]> {
    await this.assertChannelAccess(channelId, chapterId, userId);
    return this.messageRepo.findPinnedByChannel(channelId);
  }

  // ── Reactions ────────────────────────────────────────────────────────

  async toggleReaction(
    messageId: string,
    chapterId: string,
    userId: string,
    emoji: string,
  ) {
    await this.assertMessageAccess(messageId, chapterId, userId);

    const existing = await this.reactionRepo.findOne(messageId, userId, emoji);

    if (existing) {
      await this.reactionRepo.delete(messageId, userId, emoji);
      return { action: 'removed' as const };
    }

    const reaction = await this.reactionRepo.create({
      message_id: messageId,
      user_id: userId,
      emoji,
    });
    return { action: 'added' as const, reaction };
  }

  async getReactions(messageId: string, chapterId: string, userId: string) {
    await this.assertMessageAccess(messageId, chapterId, userId);
    return this.reactionRepo.findByMessage(messageId);
  }

  /**
   * Hot-path action / reaction / vote. Mirrors the retired `chat-react`
   * Edge Function. Writes to `chat_message_actions` (Chunk 02) — distinct
   * from the legacy `message_reactions` table used by `toggleReaction`.
   *
   * - Authorizes via message → channel → chapter membership.
   * - Atomic dedup via the unique index `(message_id, user_id, action_type)`:
   *   a 23505 from the insert surfaces as `deduplicated: true` (HTTP 200)
   *   instead of a 5xx — no read-then-insert TOCTOU.
   * - Vote-change semantics (ADR-07): when `action_type === "vote"` the
   *   23505 path UPSERTS instead — same row id, replaced `payload`,
   *   bumped `created_at` — so subscribed clients see a Realtime UPDATE
   *   rather than a second row.
   */
  async recordMessageAction(
    messageId: string,
    chapterId: string,
    userId: string,
    input: { action_type: string; payload?: Record<string, unknown> | null },
  ): Promise<{
    action: ChatMessageAction;
    deduplicated: boolean;
    updated?: boolean;
  }> {
    await this.assertMessageAccess(messageId, chapterId, userId);

    const payload = input.payload ?? {};
    const isVote = input.action_type === VOTE_ACTION_TYPE;

    try {
      const action = await this.actionRepo.create({
        message_id: messageId,
        user_id: userId,
        action_type: input.action_type,
        payload,
      });
      return { action, deduplicated: false };
    } catch (error) {
      if (!(error instanceof ChatMessageActionDuplicateError)) throw error;

      if (isVote) {
        const updated = await this.actionRepo.updateForVote(
          messageId,
          userId,
          input.action_type,
          payload,
        );
        if (!updated) throw error;
        return { action: updated, deduplicated: false, updated: true };
      }

      const existing = await this.actionRepo.findOne(
        messageId,
        userId,
        input.action_type,
      );
      if (!existing) throw error;
      return { action: existing, deduplicated: true };
    }
  }

  // ── Read Receipts ────────────────────────────────────────────────────

  async markChannelRead(channelId: string, chapterId: string, userId: string) {
    await this.assertChannelAccess(channelId, chapterId, userId);
    return this.readReceiptRepo.upsert(
      channelId,
      userId,
      new Date().toISOString(),
    );
  }

  // ── File Upload ─────────────────────────────────────────────────────

  async requestChatUploadUrl(
    channelId: string,
    chapterId: string,
    userId: string,
    filename: string,
    contentType: string,
  ) {
    await this.assertChannelAccess(channelId, chapterId, userId);

    const ext = filename.includes('.')
      ? filename.slice(filename.lastIndexOf('.')).toLowerCase()
      : '';

    if (!ALLOWED_EXTENSIONS.has(ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!ALLOWED_CONTENT_TYPES.has(contentType)) {
      throw new BadRequestException(
        `Content type "${contentType}" is not allowed`,
      );
    }

    const messageId = crypto.randomUUID();
    const storagePath = `chapters/${chapterId}/chat/${channelId}/${messageId}/${path.basename(filename)}`;

    const signedUrl = await this.storageProvider.getSignedUploadUrl(
      CHAT_BUCKET,
      storagePath,
      contentType,
    );

    return { signedUrl, storagePath, messageId };
  }
}
