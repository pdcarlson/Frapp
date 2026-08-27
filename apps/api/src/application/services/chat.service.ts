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
  allowsInThreadReplies,
  extractMentionTokens,
  isAllowedUploadExtension,
  isAllowedUploadMime,
  resolveMentions,
  validateCardPollVote,
} from '@repo/validation';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_CATEGORY_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHAT_MESSAGE_ACTION_REPOSITORY,
  CHAT_MESSAGE_ATTACHMENT_REPOSITORY,
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
  IChatMessageAttachmentRepository,
  IMessageReactionRepository,
  IChannelReadReceiptRepository,
} from '../../domain/repositories/chat.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '../../domain/repositories/member.repository.interface';
import { SUPABASE_CLIENT } from '../../infrastructure/supabase/supabase.provider';
import type { FrappSupabaseClient } from '../../infrastructure/supabase/database.types';
import { STORAGE_PROVIDER } from '../../domain/adapters/storage.interface';
import type { IStorageProvider } from '../../domain/adapters/storage.interface';
import type {
  ChatChannel,
  ChatChannelCategory,
  ChatMessage,
  ChatMessageAction,
  ChatMessageAttachmentWithUrl,
  ChatMessageKind,
  ChannelType,
  ChannelUnreadCount,
} from '../../domain/entities/chat.entity';
import { NotificationService } from './notification.service';
import { ChannelAccessService } from './channel-access.service';
import { ActivationService } from './activation.service';

const MAX_PINNED_MESSAGES = 50;
const MAX_GROUP_DM_MEMBERS = 10;
const CHAT_BUCKET = 'chat';

/**
 * Upper bound on attachments per message.
 *
 * Not a product rule anybody asked for — a bound so a single send cannot fan out
 * into an unbounded insert and an unbounded number of signed-URL mints on read.
 * Ten is well above what the composer's one-file-at-a-time picker produces.
 */
const MAX_ATTACHMENTS_PER_MESSAGE = 10;

/**
 * Signed-download-URL lifetime for an attachment, in seconds.
 *
 * One hour, matching the report-export links — long enough that a link survives
 * reading a channel, short enough that a URL copied out of devtools is not a
 * durable handle on private chapter data.
 */
const ATTACHMENT_URL_TTL_SECONDS = 3600;

// A ROLE_GATED channel that gates on nothing is denied by `canAccessChannel`
// (FRA-321), so reject the shape at the write points rather than letting a
// chapter create a channel nobody but the President can open.
const ROLE_GATED_REQUIRES_PERMISSIONS_MESSAGE =
  'A ROLE_GATED channel must specify at least one entry in required_permissions';

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

/**
 * One attachment as the client claims it after uploading to the signed URL.
 *
 * The client is trusted for the metadata and NOT for the location: the service
 * re-derives `channel_id` from the message and re-checks `storage_path` against
 * the prefix it minted, so a caller cannot attach an object belonging to another
 * chapter, another channel, or another bucket.
 */
export interface SendMessageAttachmentInput {
  storage_path: string;
  filename: string;
  content_type: string;
  byte_size?: number | null;
}

export interface SendMessageInput {
  chapter_id: string;
  channel_id: string;
  sender_id: string;
  content: string;
  /** Files uploaded to the `chat` bucket that belong to this message. */
  attachments?: SendMessageAttachmentInput[] | null;
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
  // `imported` asserts "this is archived history from another system". It is
  // written only by the archive importer on the service-role path, and it is
  // load-bearing in three places a client must not be able to reach: it is
  // excluded from unread counts, it is excluded from the Realtime carrier
  // policy, and it short-circuits the push worker. A client that could post one
  // would have a message that never notifies and never appears live.
  'imported',
]);

/** Vote action UPSERTS rather than duplicates (ADR-07). */
const VOTE_ACTION_TYPE = 'vote';

/** The poll-card payload written by the composer (`@repo/chat-core/dispatch`). */
type PollCardPayload = {
  options?: { id?: unknown }[];
  closes_at?: string | null;
  choice_mode?: 'single' | 'multi';
};

/**
 * Applies the shared poll rules to a chat-card vote, translating a rejection
 * into the same 400 the polls surface returns.
 *
 * A card whose payload carries no options is left alone rather than rejected:
 * that is a malformed message, and refusing every vote on it would turn a data
 * problem into a dead card. Cards default to single-choice, matching the
 * composer, which offers no multi-select.
 */
function assertCardPollVoteAllowed(
  messagePayload: unknown,
  actionPayload: Record<string, unknown>,
): void {
  const card = (messagePayload ?? {}) as PollCardPayload;
  const optionIds = (card.options ?? [])
    .map((option) => option?.id)
    .filter((id): id is string => typeof id === 'string');
  if (optionIds.length === 0) return;

  const rawSelection = actionPayload['option_id'];
  const selected = (
    Array.isArray(rawSelection) ? rawSelection : [rawSelection]
  ).filter((id): id is string => typeof id === 'string');

  const rejection = validateCardPollVote({
    closesAt: card.closes_at,
    optionIds,
    selected,
    choiceMode: card.choice_mode ?? 'single',
  });
  if (!rejection) return;

  switch (rejection.reason) {
    case 'closed':
      throw new BadRequestException('Poll has expired');
    case 'unknown_option':
      throw new BadRequestException(`Invalid option: ${rejection.option}`);
    case 'cardinality':
      throw new BadRequestException(
        'Single-choice poll requires exactly one option',
      );
  }
}
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
    @Inject(CHAT_MESSAGE_ATTACHMENT_REPOSITORY)
    private readonly attachmentRepo: IChatMessageAttachmentRepository,
    @Inject(MESSAGE_REACTION_REPOSITORY)
    private readonly reactionRepo: IMessageReactionRepository,
    @Inject(CHANNEL_READ_RECEIPT_REPOSITORY)
    private readonly readReceiptRepo: IChannelReadReceiptRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(STORAGE_PROVIDER)
    private readonly storageProvider: IStorageProvider,
    @Inject(SUPABASE_CLIENT)
    private readonly supabase: FrappSupabaseClient,
    private readonly notificationService: NotificationService,
    private readonly channelAccess: ChannelAccessService,
    private readonly activation: ActivationService,
  ) {}

  // ── Channels ─────────────────────────────────────────────────────────

  /**
   * The chapter's channels, reduced to the ones this caller may read.
   *
   * The filter is load-bearing, not defensive. A channel row carries `name`,
   * `description`, `required_permissions` and `member_ids`, and a DM is
   * server-named `dm-<userA>-<userB>` — so the pair in a direct message is
   * disclosed twice over by a single unfiltered row. Returning the chapter's
   * full list to everyone holding `members:view` would publish the chapter's
   * entire private and direct-message graph, which is a strictly larger leak
   * than the unread counts already filter for.
   */
  async getChannels(chapterId: string, userId: string): Promise<ChatChannel[]> {
    const channels = await this.channelRepo.findByChapter(chapterId);

    return this.channelAccess.filterAccessibleChannels(
      chapterId,
      userId,
      channels,
    );
  }

  /**
   * Route-facing single-channel read: 404 outside the caller's chapter, 403 for
   * one inside it they cannot see. Mutations use
   * {@link requireChannelInChapter} instead — see the note there.
   */
  async getChannel(
    id: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel> {
    return this.assertChannelAccess(id, chapterId, userId);
  }

  /**
   * Chapter-scoped resolve with no per-user ACL, for the `channels:manage`
   * mutations. An officer editing or deleting a channel is authorized by that
   * permission, not by membership of the channel itself, so this deliberately
   * does not run `canAccessChannel` — otherwise managing a PRIVATE channel you
   * are not in would start 403ing.
   */
  private async requireChannelInChapter(
    id: string,
    chapterId: string,
  ): Promise<ChatChannel> {
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
    const existing = await this.requireChannelInChapter(id, chapterId);

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
    await this.requireChannelInChapter(id, chapterId);
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
   * - Cross-channel reply links are rejected before the insert, as are
   *   in-thread replies in a read-only channel — a broadcast is not a thread,
   *   regardless of the sender's permissions.
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
    // Validated before anything else, because the emptiness rule below depends
    // on it: a message that is nothing but a file is a real message.
    const attachments = this.validateAttachmentInputs(
      input.attachments ?? [],
      input.chapter_id,
      input.channel_id,
    );

    if (!input.content.trim() && attachments.length === 0) {
      throw new BadRequestException(
        'A message needs content or at least one attachment',
      );
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
      // A read-only channel is a broadcast surface, so nothing in it is
      // threadable — not for a holder of `announcements:post`, not for the
      // President's `"*"`. Checked before the lookup below: the channel already
      // answers this, so a threaded announcement never costs a query.
      if (!allowsInThreadReplies(channel)) {
        throw new BadRequestException(
          'Messages in a read-only channel cannot be replied to in-thread',
        );
      }

      const replyTo = await this.messageRepo.findById(input.reply_to_id);
      if (!replyTo || replyTo.channel_id !== input.channel_id) {
        throw new BadRequestException(
          'reply_to_id must reference a message in the same channel',
        );
      }
    }

    const kind: ChatMessageKind = input.kind ?? 'text';
    const mentions = await this.resolveMentionsForChapter(
      input.chapter_id,
      input.content,
    );

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
        // `attachment_count` is a COUNT, not a copy — `chat_message_attachments`
        // stays the source of truth. It rides on the message row because a
        // `postgres_changes` echo cannot carry a join, so it is the only way a
        // client receiving a live message learns that it should ask for
        // attachments. Without it a file-only message renders as an empty bubble
        // for everyone except its sender.
        metadata:
          attachments.length > 0
            ? {
                ...(input.metadata ?? {}),
                attachment_count: attachments.length,
              }
            : (input.metadata ?? {}),
        mentions,
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
        // A retry reaches here when the FIRST attempt committed the message and
        // then failed — which is exactly the case where the attachments were
        // never written. Returning the existing row without them would make the
        // failure permanent: no later retry gets past the duplicate error, so
        // the files would stay unreachable forever. The write is idempotent on
        // `(message_id, bucket, storage_path)`, so re-running it is safe.
        await this.persistAttachments(
          existing.id,
          input.channel_id,
          attachments,
        );
        if (attachments.length === 0) {
          return { message: existing, deduplicated: true };
        }
        // And re-stamp the count. The failed first attempt cleared it (see
        // `persistAttachments`), so without this the rows and the storage
        // object exist while every client reads `attachment_count: 0` and
        // renders nothing — the same unreachable-file end state, reached the
        // long way round.
        const restored = await this.messageRepo.update(existing.id, {
          metadata: {
            ...(existing.metadata ?? {}),
            attachment_count: attachments.length,
          },
        });
        return { message: restored, deduplicated: true };
      }
      throw error;
    }

    await this.persistAttachments(message.id, input.channel_id, attachments);

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

    // Funnel step 4 (#267): the chapter's first *human* message. Server-
    // originated posts are excluded — the onboarding welcome message would
    // otherwise mark every chapter as having chatted the moment it was
    // created, which is the one thing this step must not report. The
    // deduplicated path returns above, so a client retry cannot count twice
    // either.
    if (input.system_originated !== true) {
      await this.activation.record(
        input.chapter_id,
        'activation-first-chat-message',
        { kind },
      );
    }

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

  /**
   * Resolve `@`-tokens in a message body to `users.id[]`, server-side.
   *
   * This is authoritative, and deliberately not a client responsibility: a
   * mention overrides a per-channel mute in the push rules, so a
   * client-supplied list would let any member force a push to any other member
   * in a channel they had muted on purpose.
   *
   * Candidates are the chapter roster. Scoping to the *channel* would be
   * tighter, but it is not needed for safety — the push worker builds its
   * recipient list from channel membership and only then asks whether each
   * recipient was mentioned, so a stored mention of a non-member is inert. The
   * chapter roster also keeps `@name` meaning the same thing in every channel,
   * which is what a member typing it expects.
   *
   * Failure is swallowed: a directory lookup that errors must not take the send
   * down with it. The message lands with no mentions, which costs a highlight
   * and a push tier, not the message.
   */
  private async resolveMentionsForChapter(
    chapterId: string,
    content: string,
  ): Promise<string[]> {
    // Parse before querying. `content.includes('@')` admits every email
    // address, every `@here`, and every `user@host` in a pasted log — all of
    // which used to buy a full roster fetch on the send hot path. The parser is
    // the same one that resolves the tokens a moment later, so "has a token" and
    // "resolves a token" cannot disagree about what an `@` means.
    if (extractMentionTokens(content).length === 0) return [];

    try {
      // One query, `user_id, display_name` only — see
      // `findChapterMemberIdentities`. The rows are structurally
      // `MentionCandidate`, so they pass to the resolver unmapped.
      const candidates =
        await this.memberRepo.findChapterMemberIdentities(chapterId);
      if (candidates.length === 0) return [];

      return resolveMentions(content, candidates);
    } catch (error) {
      this.logger.warn('Failed to resolve mentions; sending without them', {
        chapterId,
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
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

    // Re-resolve mentions against the new body. Skipping this leaves the stored
    // list describing text that no longer exists: editing `@jane` in never
    // counts toward her badge, and editing her out leaves a mention of a
    // message that no longer names her. `spec/behavior/chat/README.md` defines
    // mention count as a subset of the unread set, which is only true if the
    // two are recomputed together.
    //
    // No push fires on an edit, so adding a mention here highlights and counts
    // but does not notify — the alternative, re-running the push tier on every
    // edit, would make an edit a way to notify someone repeatedly.
    const mentions = await this.resolveMentionsForChapter(chapterId, content);

    return this.messageRepo.update(messageId, {
      content,
      mentions,
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
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );

    const payload = input.payload ?? {};
    const isVote = input.action_type === VOTE_ACTION_TYPE;

    // #871: this path used to check channel access and then insert whatever it
    // was handed, so a member could vote on a closed poll, pick an option that
    // does not exist, or send several selections to a single-choice poll —
    // every one of which the polls surface rejects for the same poll. The rules
    // are shared with `PollService.vote`; only the encoding differs, since this
    // side addresses options by id rather than by index.
    if (isVote && message.kind === 'poll') {
      assertCardPollVoteAllowed(message.payload, payload);
    }

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

  /**
   * Unread and mention tallies per channel, for the channel list's badges.
   *
   * The RPC deliberately returns a row for every channel in the chapter,
   * including ones the caller cannot see, so that the access rules live in
   * exactly one place instead of being restated in SQL where they could drift.
   * Filtering here is therefore load-bearing, not defensive: an unread count is
   * enough on its own to reveal that a DM between two other members exists and
   * is active. `filterAccessibleChannelIds` is the same batch predicate the
   * chapter-wide poll list uses for that reason.
   */
  async getUnreadCounts(
    chapterId: string,
    userId: string,
  ): Promise<ChannelUnreadCount[]> {
    const rows = await this.readReceiptRepo.getUnreadCounts(chapterId, userId);
    if (rows.length === 0) return [];

    const accessible = await this.channelAccess.filterAccessibleChannelIds(
      chapterId,
      userId,
      rows.map((row) => row.channel_id),
    );
    return rows.filter((row) => accessible.has(row.channel_id));
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

    if (!isAllowedUploadExtension('document', ext)) {
      throw new BadRequestException('File extension is not allowed');
    }

    if (!isAllowedUploadMime('document', contentType)) {
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

  /**
   * Checks the attachments a client claims for a message it is sending.
   *
   * The client picked the filename and the content type and uploaded the bytes
   * through a signed URL, so those it is trusted for. The *location* it is not:
   * without this check a caller could send a message claiming any object in the
   * `chat` bucket — including one from another chapter's channel — and the API
   * would happily mint them a signed download URL for it later.
   *
   * The prefix checked here is exactly the one `requestUploadUrl` mints, which is
   * why the two are worth reading together.
   */
  private validateAttachmentInputs(
    attachments: SendMessageAttachmentInput[],
    chapterId: string,
    channelId: string,
  ): SendMessageAttachmentInput[] {
    if (attachments.length === 0) return [];
    if (attachments.length > MAX_ATTACHMENTS_PER_MESSAGE) {
      throw new BadRequestException(
        `A message can carry at most ${MAX_ATTACHMENTS_PER_MESSAGE} attachments`,
      );
    }

    const prefix = `chapters/${chapterId}/chat/${channelId}/`;
    const seen = new Set<string>();

    for (const attachment of attachments) {
      const storagePath = attachment.storage_path;
      if (!storagePath.startsWith(prefix)) {
        // Deliberately does not echo the offending path back — it is
        // attacker-supplied and the caller already knows what it sent.
        throw new BadRequestException(
          'Attachment does not belong to this channel',
        );
      }
      // `..` cannot climb out of the prefix in object storage the way it does on
      // a filesystem, but a stored key containing it is still a key nothing here
      // minted, so it is rejected rather than reasoned about.
      if (storagePath.includes('..')) {
        throw new BadRequestException('Invalid attachment path');
      }
      if (seen.has(storagePath)) {
        throw new BadRequestException('Duplicate attachment');
      }
      seen.add(storagePath);

      if (!isAllowedUploadMime('document', attachment.content_type)) {
        throw new BadRequestException(
          `Content type "${attachment.content_type}" is not allowed`,
        );
      }
      if (
        attachment.byte_size != null &&
        (!Number.isFinite(attachment.byte_size) || attachment.byte_size < 0)
      ) {
        throw new BadRequestException('Invalid attachment size');
      }
    }

    return attachments;
  }

  /**
   * Writes the attachment rows for a message, and keeps `attachment_count`
   * honest if it cannot.
   *
   * This runs AFTER the message row, because `message_id` is a foreign key —
   * which means the message is already committed by the time this can fail.
   * There is no transaction spanning the two: the repositories are separate
   * PostgREST calls.
   *
   * So a bare `await` leaves the worst of both worlds on failure: the caller
   * gets a 500, and a message persists claiming `attachment_count: N` with no
   * rows behind it, which every reader renders forever as "attachment couldn't
   * be loaded". Clearing the count first degrades it to an ordinary message — a
   * truthful row — before the error surfaces.
   *
   * The error still surfaces. An attachment the sender watched upload and which
   * never became a row is exactly the silent data loss this change exists to
   * remove, so the send reports failure and the composer keeps its chips.
   */
  private async persistAttachments(
    messageId: string,
    channelId: string,
    attachments: SendMessageAttachmentInput[],
  ): Promise<void> {
    if (attachments.length === 0) return;

    try {
      await this.attachmentRepo.createMany(
        attachments.map((attachment) => ({
          message_id: messageId,
          channel_id: channelId,
          bucket: CHAT_BUCKET,
          storage_path: attachment.storage_path,
          filename: attachment.filename,
          content_type: attachment.content_type,
          byte_size: attachment.byte_size ?? null,
        })),
      );
    } catch (error) {
      try {
        const message = await this.messageRepo.findById(messageId);
        const metadata = { ...(message?.metadata ?? {}) };
        delete metadata.attachment_count;
        await this.messageRepo.update(messageId, { metadata });
      } catch (cleanupError) {
        // Best effort. If even this fails the message keeps a count it cannot
        // satisfy, so say so loudly rather than losing it inside the original
        // error the caller is about to see.
        this.logger.error(
          'Failed to clear attachment_count after a failed attachment write',
          {
            messageId,
            channelId,
            error:
              cleanupError instanceof Error
                ? cleanupError.message
                : String(cleanupError),
          },
        );
      }
      throw error;
    }
  }

  /**
   * The attachments on one message, each with a short-lived signed download URL.
   *
   * Separate from the message read rather than embedded in it, for two reasons
   * that point the same way. A download URL expires, so it has to be minted at
   * the moment it is going to be used rather than baked into a cached message
   * list — and the message cache on both clients is fed partly by Realtime rows,
   * which cannot carry a join at all. `metadata.attachment_count` is what tells a
   * client to call this.
   *
   * Access is the ordinary channel check, so a message in a channel the caller
   * cannot read answers 403/404 exactly as its own read does.
   */
  async listMessageAttachments(
    channelId: string,
    chapterId: string,
    userId: string,
    messageId: string,
  ): Promise<ChatMessageAttachmentWithUrl[]> {
    await this.assertChannelAccess(channelId, chapterId, userId);

    const message = await this.messageRepo.findById(messageId);
    if (!message || message.channel_id !== channelId) {
      throw new NotFoundException('Message not found');
    }
    // A deleted message does not hand out its files. Deletion is soft, so the
    // `ON DELETE CASCADE` never fires and the rows are still there — without
    // this check the API keeps minting fresh download URLs for content the
    // sender believes they removed, and the rule would live only in the web
    // renderer, which is not where a rule about who may fetch bytes belongs.
    if (message.is_deleted) {
      throw new NotFoundException('Message not found');
    }

    const rows = await this.attachmentRepo.findByMessage(messageId, chapterId);

    // `allSettled`, not `all`: one object the signer cannot resolve — a stale
    // path, an object removed out of band — would otherwise reject the whole
    // response and take every intact attachment on the message down with it.
    // The dead row is dropped and logged; the reader still gets the files that
    // are actually there.
    const signed = await Promise.allSettled(
      rows.map(async (row) => ({
        ...row,
        download_url: await this.storageProvider.getSignedDownloadUrl(
          row.bucket,
          row.storage_path,
          ATTACHMENT_URL_TTL_SECONDS,
          row.filename,
        ),
      })),
    );

    return signed.flatMap((outcome, index) => {
      if (outcome.status === 'fulfilled') return [outcome.value];
      this.logger.warn('Could not sign a chat attachment; omitting it', {
        messageId,
        channelId,
        storagePath: rows[index]?.storage_path,
        error:
          outcome.reason instanceof Error
            ? outcome.reason.message
            : String(outcome.reason),
      });
      return [];
    });
  }
}
