import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import {
  CHAT_SINCE_NOT_FOUND_CODE,
  extractMentionTokens,
  isDirectChannel,
  isModuleEnabled,
  resolveMentions,
} from '@repo/validation';
import { allowsInThreadReplies } from '#domain/utils/channel-access';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
  CHANNEL_READ_RECEIPT_REPOSITORY,
  ChatMessageCursorNotFoundError,
  ChatMessageDuplicateError,
} from '#domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
  IChannelReadReceiptRepository,
} from '#domain/repositories/chat.repository.interface';
import {
  MEMBER_REPOSITORY,
  type IMemberRepository,
} from '#domain/repositories/member.repository.interface';
import { clampListLimit } from '#domain/constants/list-query-limits';
import { instantOrThrow } from './instant-bound';
import type {
  ChatChannel,
  ChatChannelListItem,
  ChatChannelView,
  ChatMessage,
  ChatMessageKind,
  ChannelType,
  ChannelUnreadCount,
} from '#domain/entities/chat.entity';
import {
  ChannelAccessService,
  type ReportedMessageGrant,
} from './channel-access.service';
import { assertModuleEnabled, type EnabledModules } from './module-gate';
import { ChatBlockService } from './chat-block.service';
import {
  ChatAttachmentService,
  type SendMessageAttachmentInput,
} from './chat-attachment.service';
import { maskBlockedMessages, type MaskedChatMessage } from './chat-block-mask';
import { ActivationService } from './activation.service';
import { ChannelCacheService } from './channel-cache.service';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

const MAX_PINNED_MESSAGES = 50;
const MAX_GROUP_DM_MEMBERS = 10;
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
   * The chapter's `enabled_modules`, as `ChapterGuard` read it. Required on a
   * client send: it is what refuses a card kind whose module is off
   * ({@link MODULE_GATED_KINDS}). Absent or `null` reads as every module on,
   * the same as a chapter with no toggles stored.
   */
  enabled_modules?: EnabledModules;
  /**
   * Internal-only: set by trusted server callers (e.g. `PointsService` posting
   * a `points` card after a committed ledger write) to bypass the
   * server-originated-kind guard. Never present on `SendMessageDto`, so a
   * client request can never set it.
   */
  system_originated?: boolean;
}

/**
 * Kinds that assert a server-side side effect (a ledger write, a created task,
 * event, service entry, or rush candidate, an audit row). A client must never
 * post these directly — only a trusted server caller may, via
 * `SendMessageInput.system_originated`. `loading` stays client-postable: it is
 * the optimistic placeholder for the heavy-command pattern.
 */
const SERVER_ONLY_KINDS: ReadonlySet<ChatMessageKind> = new Set([
  'event',
  'points',
  'task',
  'hours',
  'rush',
  'system_audit',
  // `imported` asserts "this is archived history from another system". It is
  // written only by the archive importer on the service-role path, and it is
  // load-bearing in three places a client must not be able to reach: it is
  // excluded from unread counts, it is excluded from the Realtime carrier
  // policy, and it short-circuits the push worker. A client that could post one
  // would have a message that never notifies and never appears live.
  'imported',
]);

/**
 * Client-postable kinds that are a toggleable module's artifact, keyed to that
 * module. `sendMessage` refuses one while its module is off, with the same
 * refusal `ChapterGuard` returns for the module's own routes (#2993): the chat
 * send route is an always-on module's, so route metadata can't gate it.
 *
 * The server-only kinds need no entry: their only writers are the modules' own
 * services, reached through controllers that carry `@RequireModule`. `dues` is
 * here although member-invoice routes stay ungated: that exemption keeps
 * *paying* reachable for a locked chapter (`spec/product/modules.md`), and
 * posting a dues card pays nothing.
 */
const MODULE_GATED_KINDS: Readonly<Partial<Record<ChatMessageKind, string>>> = {
  poll: 'polls',
  dues: 'dues',
};

/** What {@link ChatService.deleteReportedMessage} did, and where. */
export interface ReportedMessageRemoval {
  /** True when the message was already soft-deleted and nothing was written. */
  alreadyDeleted: boolean;
  /** The message's channel — an id only; it opens nothing. */
  channelId: string;
}

/** What {@link ChatService.reportedMessageState} knows about a reported message. */
export interface ReportedMessageState {
  channelId: string;
  isDeleted: boolean;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(CHANNEL_READ_RECEIPT_REPOSITORY)
    private readonly readReceiptRepo: IChannelReadReceiptRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly channelAccess: ChannelAccessService,
    private readonly activation: ActivationService,
    private readonly channelCache: ChannelCacheService,
    // Report and block (#2257) live in their own services; the hot path needs
    // only the block list, to mask what it serves.
    private readonly chatBlocks: ChatBlockService,
    // Attachments, avatars and the purge (#1380): every read and write of the
    // chat buckets goes through it. `sendMessage` keeps the ordering.
    private readonly attachments: ChatAttachmentService,
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
  async getChannels(
    chapterId: string,
    userId: string,
  ): Promise<ChatChannelView[]> {
    const accessible = await this.accessibleChannels(chapterId, userId);
    return this.channelAccess.withPostCapability(chapterId, userId, accessible);
  }

  /**
   * `GET /v1/channels`: {@link getChannels} plus whether this caller has hidden
   * each row from their own list (#2303).
   *
   * Its own method rather than a field `getChannels` always computes, because
   * `getChannels` has callers that only look for one chapter channel (the
   * activity feed finding `#announcements`), and the hidden lookup is a round
   * trip they would pay for and throw away. It runs beside the post-capability
   * projection, not after it, so it adds no latency to the list.
   */
  async getChannelList(
    chapterId: string,
    userId: string,
  ): Promise<ChatChannelListItem[]> {
    const accessible = await this.accessibleChannels(chapterId, userId);
    const [views, hidden] = await Promise.all([
      this.channelAccess.withPostCapability(chapterId, userId, accessible),
      // Only a caller with a DM in the list can have hidden anything.
      accessible.some((channel) => channel.type === 'DM')
        ? this.findHiddenChannelIds(chapterId, userId)
        : Promise.resolve(new Set<string>()),
    ]);
    return views.map((view) => ({ ...view, hidden: hidden.has(view.id) }));
  }

  private async accessibleChannels(
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel[]> {
    const channels = await this.channelRepo.findByChapter(chapterId);
    return this.channelAccess.filterAccessibleChannels(
      chapterId,
      userId,
      channels,
    );
  }

  /**
   * The DMs this caller hid (#2303), or none when the lookup fails.
   *
   * Failing open is deliberate, and it is the only direction that is safe
   * here. This read sits on the chat home screen of every member with a DM,
   * and a hide is a list preference, not an access rule: a thread shown that
   * the member had put away costs them a long press, while a thrown error
   * costs them the whole channel list. It also keeps the list working against
   * a database the `get_hidden_channel_ids` migration has not reached — an
   * API-only deploy, or that migration rolled back.
   */
  private async findHiddenChannelIds(
    chapterId: string,
    userId: string,
  ): Promise<Set<string>> {
    try {
      return await this.readReceiptRepo.findHiddenChannelIds(chapterId, userId);
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Could not read hidden channels for chapter ${chapterId}; showing them all`,
        error,
      );
      return new Set();
    }
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
  ): Promise<ChatChannelView> {
    const channel = await this.assertChannelAccess(id, chapterId, userId);
    const [withCapability] = await this.channelAccess.withPostCapability(
      chapterId,
      userId,
      [channel],
    );
    return withCapability;
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

  /**
   * @param userId the caller, passed positionally like every other policy input
   *   on this service (`getChannels`, `getChannel`, `createGroupDm`) rather than
   *   as a field on `input`, whose members are all `chat_channels` columns.
   *   A PRIVATE channel seeds its `member_ids` with exactly this user (#1008).
   */
  async createChannel(
    input: CreateChannelInput,
    userId: string,
  ): Promise<ChatChannel> {
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
      // Seed the creator so a PRIVATE channel is readable by at least one
      // person. `canAccessChannel` resolves PRIVATE as membership of this list
      // with **no `"*"` wildcard bypass**, so a row landing with `member_ids`
      // NULL is invisible to every user including its creator and a President.
      // Before #1302 there was no repair path, since `updateChannel` cannot
      // write this column, so such a channel was unreachable from every read
      // surface once #1001 filtered the list (#1008). `addPrivateChannelMember`
      // now repairs one, but only for an officer who already has its id.
      //
      // Only PRIVATE. PUBLIC and ROLE_GATED resolve access by chapter
      // membership and permissions respectively and never consult this column,
      // so populating it there would imply a membership that means nothing.
      // DM and GROUP_DM cannot reach here — they are rejected above and set
      // their own membership in `getOrCreateDm` / `createGroupDm`.
      member_ids: input.type === 'PRIVATE' ? [userId] : null,
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
        | 'default_notification_level'
      >
    >,
  ): Promise<ChatChannel> {
    const existing = await this.requireChannelInChapter(id, chapterId);

    // A DM has no officer, and the push worker defaults every DM to `all`
    // whatever this column holds (`defaultLevelFor`), so a stored value there
    // would be a setting that does nothing. Refused rather than ignored.
    if (isDirectChannel(existing) && data.default_notification_level != null) {
      throw new BadRequestException(
        'A DM or group DM has no channel default notification level',
      );
    }

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

    const updated = await this.channelRepo.update(id, chapterId, data);
    // `required_permissions` is a push-audience authorization input (see
    // `ChannelCacheService`), not display data — evict unconditionally rather
    // than only when that field is present in `data`, so a future field this
    // service starts accepting here can't silently reintroduce the staleness
    // window by omission (#988).
    this.channelCache.invalidate(id);
    return updated;
  }

  async deleteChannel(id: string, chapterId: string): Promise<void> {
    await this.requireChannelInChapter(id, chapterId);
    await this.channelRepo.delete(id, chapterId);
    // A deleted channel's stale row must not outlive it in the push worker's
    // cache — see `updateChannel`'s note on `ChannelCacheService`.
    this.channelCache.invalidate(id);
  }

  /**
   * @param openedBy the member opening the DM, when a member is (the
   *   `POST /v1/channels/dm` route). Opening a DM you hid is the explicit way
   *   back to it, so it clears your hide (#2303) — and only yours: the other
   *   member's list is theirs. Server-originated callers (the invite-accept
   *   system DM) pass nothing, because nobody opened anything; their message
   *   resurfaces a hidden thread the ordinary way, as a new message.
   *
   * Race-safe (#2788): two overlapping calls for one pair can both miss
   * `findDm`, but the database holds one DM per pair, so `createDm` hands the
   * slower one the row the faster one inserted. Both callers get the same
   * channel.
   */
  async getOrCreateDm(
    input: CreateDmInput,
    openedBy?: string,
  ): Promise<ChatChannel> {
    if (input.member_ids.length !== 2) {
      throw new BadRequestException('A DM requires exactly 2 members');
    }

    const existing = await this.channelRepo.findDm(
      input.chapter_id,
      input.member_ids,
    );
    if (existing) {
      if (openedBy) {
        // Never at the cost of the open itself: a member messaging someone
        // must reach the thread even if their list stays behind. The thread
        // still resurfaces on its next message.
        await this.readReceiptRepo
          .unhideChannel(existing.id, openedBy)
          .catch((error: unknown) => {
            logThrowable(
              this.logger,
              'warn',
              `Could not unhide reopened DM ${existing.id} in chapter ${input.chapter_id}`,
              error,
            );
          });
      }
      return existing;
    }

    return this.channelRepo.createDm(input.chapter_id, input.member_ids);
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

  /**
   * `POST /v1/channels/:id/leave`: the one exit from a direct conversation,
   * and it means a different thing per type (`spec/behavior/chat/README.md`
   * § Direct Messages).
   *
   * - **Group DM:** the member leaves. They are removed from `member_ids`,
   *   and once one member remains the channel is archived.
   * - **1:1 DM:** the member hides it from their own list (#2303). It cannot
   *   take the Group-DM path: a 1:1 DM whose member list drops to one is not a
   *   conversation that ended, it is one the other member can no longer be
   *   reached in — and an archive would take it off *their* list too. So
   *   nothing about the channel changes, no message is deleted, and the other
   *   member's view is untouched; the caller's read receipt records the hide.
   * - **Anything else:** rejected, as before. There is no leave for a chapter
   *   channel (`spec/behavior/chat/README.md` § Direct Messages).
   *
   * `assertChannelAccess` alone would accept leaving a PUBLIC, PRIVATE or
   * ROLE_GATED channel the caller can read, so the type dispatch below is what
   * rejects those.
   *
   * The Group-DM removal goes through the `leave_group_dm` RPC
   * (`channelRepo.leaveGroupDm`), not a read-then-write `update()`: two
   * members leaving at nearly the same time would otherwise each compute
   * their target `member_ids` from the same stale snapshot, and whichever
   * `update()` commits last would silently discard the other's removal
   * (`/diff-review` caught this in the first pass — see the RPC's migration
   * comment for why the SQL-side `array_remove` is what makes it safe).
   */
  async leaveChannel(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<void> {
    const channel = await this.assertChannelAccess(
      channelId,
      chapterId,
      userId,
    );

    if (channel.type === 'DM') {
      const receipt = await this.readReceiptRepo.hideDirectMessage(
        channelId,
        chapterId,
        userId,
      );
      if (!receipt) {
        // Lost a race with a concurrent delete — `assertChannelAccess` proved
        // this row existed and was a DM a moment ago, and a type never changes.
        throw new NotFoundException('Channel not found');
      }
      // No cache eviction: the push worker's cached row is unchanged, and a
      // hidden DM still notifies — a new message is what brings it back.
      return;
    }

    if (channel.type !== 'GROUP_DM') {
      throw new BadRequestException('Only a direct message can be left');
    }

    const updated = await this.channelRepo.leaveGroupDm(
      channelId,
      chapterId,
      userId,
    );
    if (!updated) {
      // Lost a race with a concurrent delete, or the type changed under us
      // between the check above and the RPC — `assertChannelAccess` already
      // proved this row existed and was a GROUP_DM a moment ago.
      throw new NotFoundException('Channel not found');
    }
    // A left/archived Group DM must not keep serving the push worker's stale
    // member list — same reasoning as `updateChannel`'s cache invalidation.
    this.channelCache.invalidate(channelId);
  }

  /**
   * `POST /v1/channels/:id/members` (#1302): add a chapter member to a PRIVATE
   * channel. Until this route the creator seed was the whole of PRIVATE
   * membership (#1008). The rules are in `spec/behavior/chat/README.md`
   * § Channels.
   *
   * Authorized by `channels:manage` at the controller, not by membership of
   * the channel, exactly like `updateChannel` and `deleteChannel`
   * ({@link requireChannelInChapter}): an officer can add members to a
   * private channel they cannot read, themselves included.
   *
   * `member_ids` is a bare `uuid[]` with no foreign key, so nothing at the
   * database stops a foreign id landing in it. The chapter check here is the
   * only one. `MemberService.remove` takes a departing member off every
   * PRIVATE channel, so a re-invite doesn't bring their old access back.
   * The check here is not atomic with the write: a member removed from the
   * chapter at the same moment as this add can still end up listed. That id
   * admits nobody while they are out of the chapter (`canAccessChannel`
   * requires chapter membership first), and it survives only if both writes
   * race each other.
   *
   * Idempotent: adding someone already listed succeeds and changes nothing.
   */
  async addPrivateChannelMember(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel> {
    await this.requirePrivateChannel(channelId, chapterId);

    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) {
      throw new BadRequestException(
        'Only a member of this chapter can be added to one of its channels',
      );
    }

    const updated = await this.channelRepo.addPrivateChannelMember(
      channelId,
      chapterId,
      userId,
    );
    // Deleted between the check above and the RPC.
    if (!updated) throw new NotFoundException('Channel not found');
    // `member_ids` decides who is pushed this channel's messages
    // (`ChannelCacheService`), so the worker must not keep the old list.
    this.channelCache.invalidate(channelId);
    return updated;
  }

  /**
   * `DELETE /v1/channels/:id/members/:userId` (#1302): remove someone from a
   * PRIVATE channel. Authorized like {@link addPrivateChannelMember}.
   *
   * No chapter-membership check on the target, so an id that should never
   * have been listed, or whose member has left the chapter, can always be
   * cleaned out: it admits nobody, so removing it takes no reader away.
   * Idempotent for someone not listed, including on a NULL or empty list.
   *
   * **Removing the last current chapter member listed is refused (409).** A
   * PRIVATE channel nobody in the chapter can read drops out of every
   * access-filtered list, officers' included, which is #1008's defect by
   * another route. The RPC counts chapter members rather than array entries,
   * since an id whose member has left admits nobody, and holds the guard in
   * its `WHERE`, so two concurrent removals of the last two members cannot
   * both pass it. A caller who wants the channel gone deletes it.
   */
  async removePrivateChannelMember(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChatChannel> {
    await this.requirePrivateChannel(channelId, chapterId);

    const updated = await this.channelRepo.removePrivateChannelMember(
      channelId,
      chapterId,
      userId,
    );
    if (!updated) {
      // The RPC matches nothing either because the channel went away after
      // the check above, or because this removal would take away the last
      // current chapter member listed. Re-read to tell the two apart; a type
      // never changes.
      const stillThere = await this.channelRepo.findById(channelId, chapterId);
      if (!stillThere) throw new NotFoundException('Channel not found');
      throw new ConflictException(
        'A private channel must keep at least one member of the chapter. Delete the channel instead.',
      );
    }
    this.channelCache.invalidate(channelId);
    return updated;
  }

  /**
   * {@link requireChannelInChapter}, narrowed to PRIVATE. DM and Group DM
   * membership is fixed at creation apart from leaving, and PUBLIC and
   * ROLE_GATED channels never consult `member_ids`.
   */
  private async requirePrivateChannel(
    channelId: string,
    chapterId: string,
  ): Promise<ChatChannel> {
    const channel = await this.requireChannelInChapter(channelId, chapterId);
    if (channel.type !== 'PRIVATE') {
      throw new BadRequestException(
        'Only a private channel has members that can be added or removed',
      );
    }
    return channel;
  }

  // ── Messages ─────────────────────────────────────────────────────────

  /**
   * Channel history for one viewer, with that viewer's block list applied
   * (#2257, `spec/behavior/chat/README.md` § The masking contract).
   *
   * The masking is per-caller, which is why it cannot live in the repository or
   * in a database view: the same row reads differently for two members of the
   * same channel. `maskBlockedMessages` is the shared rule — a pure function in
   * `chat-block-mask.ts` — so a second read surface owes the same guarantee
   * without a second copy of it.
   *
   * **The block-list read is not defended against.** If it throws, this throws:
   * the contract is explicit that "a block list that cannot be read is not an
   * empty block list", and a `.catch(() => [])` here would quietly unmask every
   * blocked member for as long as the table was unreachable — failing open on
   * the one feature whose entire value is that it does not.
   *
   * Server masking is necessary but not sufficient on its own, and nothing
   * downstream may key off the `BLOCKED_MESSAGE_CONTENT` sentinel. Clients also receive
   * rows over a Supabase Realtime `postgres_changes` echo, which carries no
   * viewer and so cannot be masked here; they apply their own list, fetched from
   * `GET /v1/chat/blocks`, and read `sender_blocked` rather than the sentinel.
   */
  async getMessages(
    channelId: string,
    chapterId: string,
    userId: string,
    options?: { limit?: number; before?: string; since?: string },
  ): Promise<MaskedChatMessage[]> {
    await this.assertChannelAccess(channelId, chapterId, userId);
    instantOrThrow('before', options?.before);
    const [messages, blockedUserIds] = await Promise.all([
      this.messageRepo
        .findByChannel(channelId, {
          ...options,
          limit: clampListLimit(options?.limit),
        })
        .catch((error: unknown) => {
          // Coded, because "Channel not found" is a 404 on this route too and
          // the backfill drops its cursor only for this one (#2807).
          if (error instanceof ChatMessageCursorNotFoundError) {
            throw new NotFoundException({
              code: CHAT_SINCE_NOT_FOUND_CODE,
              message: 'The since message is not in this channel',
            });
          }
          throw error;
        }),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    return maskBlockedMessages(messages, blockedUserIds);
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
   * - Emits no Realtime broadcast. Delivery is the Postgres Changes
   *   subscription on `chat_messages` (`spec/ui/resilience/message-delivery.md#receiving-messages-realtime`), which
   *   clients hold on `chat:channel:<id>`. A `new_message` broadcast used to
   *   be emitted here on a bespoke `chapter:<id>` topic, left over from the
   *   `chat-send` Edge Function ADR-11 retired; no client ever subscribed to
   *   it, so it was removed in #472 rather than instrumented. See the ADR-11
   *   amendment (2026-09-02, #472); ADR-02 is the rule that Broadcast in chat
   *   carries presence and typing rather than messages, and ADR-10 is the one
   *   that fixes the topic at `chat:channel:<id>`. Pinned by
   *   `chat-realtime-carrier.spec.ts`.
   */
  async sendMessage(
    input: SendMessageInput,
  ): Promise<{ message: ChatMessage; deduplicated: boolean }> {
    // Validated before anything else, because the emptiness rule below depends
    // on it: a message that is nothing but a file is a real message.
    const attachments = this.attachments.validateAttachmentInputs(
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

    const gatedModule = MODULE_GATED_KINDS[kind];
    if (
      gatedModule &&
      !isModuleEnabled(input.enabled_modules ?? null, gatedModule)
    ) {
      // A replay of a card that committed before the module was switched off
      // is not a new write: answer it as the duplicate below would, or the
      // client's outbox marks a card that exists on the server as failed.
      // Nothing is written on this path, not even the attachment repair.
      const existing = input.client_message_id
        ? await this.messageRepo.findByClientMessageId(
            input.channel_id,
            input.sender_id,
            input.client_message_id,
          )
        : null;
      if (existing && existing.kind === kind) {
        return { message: existing, deduplicated: true };
      }
      assertModuleEnabled(input.enabled_modules ?? null, gatedModule);
    }

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
        await this.attachments.persistAttachments(
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

    await this.attachments.persistAttachments(
      message.id,
      input.channel_id,
      attachments,
    );

    // No push is sent from here. The push worker handles every
    // `chat_messages` insert, this one included, and is the only chat push
    // path (#2771): it applies the member's per-channel level, presence, burst
    // bundling and the block and read filters. A second path here used to push
    // DMs and announcements again on top of it, and ignored a muted DM.

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
      logThrowable(
        this.logger,
        'warn',
        `Failed to resolve mentions in chapter ${chapterId}; sending without them`,
        error,
      );
      return [];
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
   * Authorize a caller for a message by resolving message → channel → chapter.
   * A message in a channel the caller cannot see (or in another chapter) is
   * rejected.
   *
   * Delegates to the shared {@link ChannelAccessService} for the same reason
   * {@link assertChannelAccess} does: the bookmark surface (#462) authorizes
   * messages too, and a second copy of this resolution would be free to drift
   * from the one the chat hot path uses. The body moved there; this stays as a
   * thin delegate so the call sites below read unchanged.
   *
   * `grant` is passed through untouched; only {@link deleteReportedMessage}
   * supplies one.
   */
  private assertMessageAccess(
    messageId: string,
    chapterId: string,
    userId: string,
    operation: 'read' | 'post' = 'read',
    grant?: ReportedMessageGrant,
  ): Promise<ChatMessage> {
    return this.channelAccess.assertMessageAccess(
      messageId,
      chapterId,
      userId,
      operation,
      grant,
    );
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

    // An imported Discord message is a record of what was said then. Its
    // sender can be a member (they linked their Discord account, #2878), who
    // may delete it like any message of theirs but not rewrite it. The clients
    // already hide Edit on imported rows (`canEditMessage` in
    // `@repo/chat-core`); this is the rule, since a client is not a control.
    // After the ownership check, so a non-owner learns nothing about the row.
    if (message.kind === 'imported') {
      throw new ForbiddenException('Imported messages cannot be edited');
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

    return this.softDeleteMessage(message, chapterId);
  }

  /**
   * Remove the one message an open report names (#2311, option 1).
   *
   * **Not a second delete path.** Authorization goes through the same
   * `assertMessageAccess` every message action uses, with the report as an
   * explicit capability ({@link ReportedMessageGrant}) rather than a forked
   * predicate; the write is the same {@link softDeleteMessage} `deleteMessage`
   * ends in, so the tombstone, the `metadata` wipe and the attachment purge
   * cannot drift between an author deleting their own message and an officer
   * removing a reported one.
   *
   * The officer's `channels:manage` is proven by the route
   * (`POST /v1/chat/reports/:id/remove-message`), in the same chapter the grant
   * was read in. What this adds on top:
   *
   * - **No sender check.** The report, not authorship, is the authority.
   * - **A message already soft-deleted is not an error**, and nothing is
   *   written: `{ alreadyDeleted: true }`. The content is gone whoever removed
   *   it — its sender, an officer's ordinary delete, a sibling report's
   *   removal, or an earlier attempt of this same call that failed after the
   *   delete landed — and the report still has to close. Refusing would strand
   *   it open with nothing left to act on, and a retry of a half-finished
   *   removal would never succeed. The caller learns which happened, so it can
   *   say so honestly rather than claim a removal it did not make.
   *
   * `chapterId` is the caller's active chapter, taken separately from the
   * grant's own so the predicate compares two independently sourced values
   * rather than one against itself.
   *
   * Returns no part of the row but its `channel_id`: the caller must not
   * receive the message. The only thing the officer is entitled to from a DM
   * is the snapshot the report already holds. The channel id is an id, not a
   * read — every channel route still refuses it — and it is what lets the
   * client blank that one timeline's cached copy rather than refetch them all
   * (`ChatReportRemovalDto.channel_id`).
   */
  async deleteReportedMessage(
    grant: ReportedMessageGrant,
    chapterId: string,
    officerUserId: string,
  ): Promise<ReportedMessageRemoval> {
    const message = await this.assertMessageAccess(
      grant.messageId,
      chapterId,
      officerUserId,
      'read',
      grant,
    );

    if (message.is_deleted) {
      return { alreadyDeleted: true, channelId: message.channel_id };
    }

    await this.softDeleteMessage(message, chapterId);
    return { alreadyDeleted: false, channelId: message.channel_id };
  }

  /**
   * Whether a reported message is still there, and which channel it is in —
   * or `null` when there is no such message in this chapter (hard-deleted by a
   * channel delete or the import purge).
   *
   * **A state read, not an authorization.** It returns no content and grants
   * nothing, and it has exactly three callers in `ChatReportService`, each
   * passing a message id it already holds by right: a message the reporter
   * was just authorized to read (the re-check after a report is written); the
   * message a chapter-scoped, reviewer-visible report names, for the removal
   * route's answer to a report that is already `actioned`; and the same
   * message after a removal of it failed on a 5xx or a lost response
   * (`messageStateAfterFailedRemoval`), from a report that call had just
   * claimed. The channel must still resolve inside `chapterId`, as every
   * message path here requires.
   */
  async reportedMessageState(
    messageId: string,
    chapterId: string,
  ): Promise<ReportedMessageState | null> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) return null;
    const channel = await this.channelRepo.findById(
      message.channel_id,
      chapterId,
    );
    if (!channel) return null;
    return { channelId: message.channel_id, isDeleted: message.is_deleted };
  }

  /**
   * The soft delete itself — shared by {@link deleteMessage} and
   * {@link deleteReportedMessage}, which differ only in who may call them.
   * Callers authorize first; this does not.
   */
  private async softDeleteMessage(
    message: Pick<ChatMessage, 'id' | 'kind' | 'metadata'>,
    chapterId: string,
  ): Promise<ChatMessage> {
    const messageId = message.id;
    const deleted = await this.messageRepo.update(messageId, {
      content: '[message deleted]',
      is_deleted: true,
      metadata: tombstoneMetadata(message),
    });

    // Purge after the flag lands, not before. Soft delete leaves the attachment
    // rows in place (they cascade only with the message itself), so nothing is
    // lost by reading them afterwards — the ordering is chosen for the failure
    // modes, not for access. `listMessageAttachments` 404s an `is_deleted`
    // message, so once this update commits the API mints no *new* download
    // URLs. Purging first and then failing the update would leave a visible
    // message with dead downloads; this way a failed purge leaves an orphan,
    // which is the state we are in today anyway.
    //
    // Everything after this point is best-effort — the row is the source of
    // truth, and a Storage or PostgREST fault must not roll back a delete the
    // member asked for, or turn it into a 500.
    await this.attachments.purgeRemovedMessageAttachments(messageId, chapterId);

    return deleted;
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

  /**
   * The channel's pinned messages, masked for this viewer exactly like
   * {@link getMessages}.
   *
   * Pinning is an officer action but the pinned list is not an officer
   * moderation surface — every member of the channel reads it, so a pinned
   * message from a blocked member is channel content and the contract's
   * "Channel messages → Hidden" row covers it. Leaving this unmasked would have
   * been a durable hole in the mask, since a pin is precisely the message that
   * stays in front of the blocker indefinitely.
   */
  async getPinnedMessages(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<MaskedChatMessage[]> {
    await this.assertChannelAccess(channelId, chapterId, userId);
    const [messages, blockedUserIds] = await Promise.all([
      this.messageRepo.findPinnedByChannel(channelId),
      this.chatBlocks.listBlockedUserIds(chapterId, userId),
    ]);
    return maskBlockedMessages(messages, blockedUserIds);
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

    // No "has a DM" guard on the hidden lookup, unlike `getChannelList`: this
    // read never loads channel types (`filterAccessibleChannelIds` returns
    // ids), so a guard would have to wait for the access check and serialize
    // the two on the most-polled chat read. The RPC is cheap for a member who
    // hid nothing: it starts from their own receipts with `hidden_at` set.
    const [accessible, hidden] = await Promise.all([
      this.channelAccess.filterAccessibleChannelIds(
        chapterId,
        userId,
        rows.map((row) => row.channel_id),
      ),
      this.findHiddenChannelIds(chapterId, userId),
    ]);
    // A DM the caller hid (#2303) has no row on screen to open, so a count on
    // it would light the app badge with nothing to clear it from. The hide
    // marks the thread read, and anything that makes it unread again also
    // brings it back, with one exception: a member the caller has blocked
    // can still post into it (a block withholds, it never refuses), and that
    // count is exactly the one that must not surface here. A missing row
    // reads as fully read on both clients.
    return rows.filter(
      (row) => accessible.has(row.channel_id) && !hidden.has(row.channel_id),
    );
  }
}

/**
 * What a soft-deleted message keeps of its `metadata`.
 *
 * Nothing, except an imported row's `discord_import_id`: it is the only key the
 * import purge selects on (`SupabaseDiscordImportRepository.deleteImportedMessages`),
 * so wiping it would leave the tombstone behind when its import is deleted,
 * still carrying the Discord author and an avatar path into purged storage. A
 * linked member can delete their own imported messages (#2878), so this is
 * reachable by any member, not only a moderator.
 */
export function tombstoneMetadata(
  message: Pick<ChatMessage, 'kind' | 'metadata'>,
): Record<string, unknown> {
  if (message.kind !== 'imported') return {};
  const importId: unknown = message.metadata?.discord_import_id;
  return typeof importId === 'string' ? { discord_import_id: importId } : {};
}
