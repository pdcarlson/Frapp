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
  canChangeMessageFlag,
  isAnnouncementChannel,
  isAskAnswerPostedBy,
  isDirectChannel,
  isModuleEnabled,
  mentionPicksIn,
  readMentionPicks,
  withoutObjectReplacement,
  type ChatMessageFlag,
  type MentionPick,
} from '@repo/validation';
import { channelAllowsThreads } from '#domain/utils/channel-access';
import { stampCardClosed } from './card-close';
import { normalizeSignupCard } from '#domain/utils/signup-card-rules';
import { isCardClosed } from '#domain/utils/card-closing';
import { normalizeFormCard } from '#domain/utils/form-card-rules';
import {
  CHAT_THREAD_REPOSITORY,
  type IChatThreadRepository,
} from '#domain/repositories/chat-thread.repository.interface';
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
import {
  USER_REPOSITORY,
  type IUserRepository,
} from '#domain/repositories/user.repository.interface';
import { clampListLimit } from '#domain/constants/list-query-limits';
import { instantOrThrow } from './instant-bound';
import type {
  ChatChannel,
  ChatChannelListItem,
  ChatChannelView,
  ChatForwardedGif,
  ChatForwardedMessage,
  ChatMessage,
  ChatMessageKind,
  ChannelType,
  ChannelUnreadCount,
  ChannelLatestMessage,
} from '#domain/entities/chat.entity';
import {
  ChannelAccessService,
  type ChannelMemberEntry,
  type ReportedMessageGrant,
} from './channel-access.service';
import { assertModuleEnabled, type EnabledModules } from './module-gate';
import { ChatBlockService } from './chat-block.service';
import {
  ChatAttachmentService,
  attachmentMetadataOf,
  type SendMessageAttachmentInput,
} from './chat-attachment.service';
import {
  DELETED_MESSAGE_CONTENT,
  maskBlockedMessages,
  redactDeletedMessage,
  tombstoneMetadata,
  tombstonePayload,
  type MaskedChatMessage,
} from './chat-block-mask';
import { ActivationService } from './activation.service';
import { ChannelCacheService } from './channel-cache.service';
import { ChannelAccessListService } from './channel-access-list.service';
import { ChatMentionService } from './chat-mention.service';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { chatPushPreview } from './chat-push-preview';
import type { MessageGif } from './gif.service';
import { NotificationService } from './notification.service';

const MAX_PINNED_MESSAGES = 50;
const MAX_GROUP_DM_MEMBERS = 10;
// `required_permissions` and `is_read_only` were how a page from before #3722
// said who could see and post. A page left open across the deploy may still
// send them; one that would change access is refused rather than ignored, so
// an officer never believes a channel is locked down when it isn't.
const LEGACY_ACCESS_FIELDS_MESSAGE =
  'Frapp was updated. Reload the page to choose who can see and post in this channel.';

// A DM or group DM belongs to its members (#3633), so `PATCH /v1/channels/:id`
// refuses every field of one.
const DIRECT_CHANNEL_SETTINGS_MESSAGE =
  'A DM or group DM has no channel settings to change';

export interface CreateChannelInput {
  chapter_id: string;
  name: string;
  description?: string | null;
  type: ChannelType;
  /** `undefined` copies the category's list; `null` is everyone (#3722). */
  who_can_see?: string[] | null;
  /** `undefined` copies the category's list; `null` is everyone who can see it. */
  who_can_post?: string[] | null;
  category_id?: string | null;
  display_locked?: boolean;
  /** Pre-#3722 fields, refused when they would change access. */
  required_permissions?: string[] | null;
  is_read_only?: boolean;
}

export interface UpdateChannelInput extends Partial<
  Pick<
    ChatChannel,
    | 'name'
    | 'description'
    | 'category_id'
    | 'default_notification_level'
    | 'is_default'
    | 'activity_excluded'
  >
> {
  who_can_see?: string[] | null;
  who_can_post?: string[] | null;
  /** Copy the category's lists, so the channel matches it again. */
  match_category_access?: boolean;
  /** Pre-#3722 fields, refused when they would change access. */
  required_permissions?: string[] | null;
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
  /**
   * Post as a reply inside this message's thread (#3785) instead of the
   * timeline. The root must be a timeline message in the same channel.
   */
  thread_root_id?: string | null;
  metadata?: Record<string, any>;
  /**
   * A GIF from the picker (#4631), already checked by `GifService.messageGif`.
   * Stored as the server's own `metadata.gif`; the message has no text and no
   * files.
   */
  gif?: MessageGif | null;
  /**
   * The members the composer's `@` picker wrote into `content` (#3835): a
   * token spelling a picked label reaches that member or nobody. Stored as
   * the server's own `metadata.mention_picks`, so an edit reads the body the
   * same way.
   */
  mention_picks?: readonly MentionPick[] | null;
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
  /**
   * Internal-only: the copy `forwardMessage` built of the message being
   * forwarded (#4864). Never on `SendMessageDto`, so a client can't claim a
   * copy of something it never read. With it, `content` (the forwarder's
   * comment) may be empty.
   */
  forwarded_from?: ChatForwardedMessage | null;
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
  // An Ask Frapp answer posted to the channel (#4713). Written only by
  // `AskPostService`, from an answer the server itself sealed, under the
  // Frapp sender. A client that could post one would be writing in Frapp's
  // name with sources it made up.
  'ask_answer',
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

/**
 * A poll card's early close (`payload.closed_at` / `closed_by`, #3794) is
 * written only by `PollService.close`, which checks the caller is the poll's
 * creator. A client composes the rest of the card, so the pair is dropped from
 * what it posts: a card can't arrive already closed, or "closed by" someone
 * else.
 */
function withoutServerPollFields(
  kind: ChatMessageKind,
  payload: Record<string, any> | null | undefined,
): Record<string, any> | null {
  if (!payload) return null;
  if (kind !== 'poll') return payload;
  const card = { ...payload };
  delete card.closed_at;
  delete card.closed_by;
  return card;
}

/**
 * `ChatService.closeCard`'s refusals for each kind it closes. The sign-up
 * wording is step 2's, which `@repo/validation`'s member copy keys on.
 */
const CLOSE_COPY: Readonly<
  Record<
    'signup' | 'form',
    {
      deleted: string;
      forbidden: string;
      malformed: string;
      alreadyClosed: string;
    }
  >
> = {
  signup: {
    deleted: 'Cannot close a deleted sign-up',
    forbidden:
      'Only the sign-up’s creator or a member who manages channels can close it',
    malformed: 'Malformed sign-up card',
    alreadyClosed: 'Sign-ups are already closed',
  },
  form: {
    deleted: 'Cannot close a deleted form',
    forbidden:
      'Only the form’s creator or a member who manages channels can close it',
    malformed: 'Malformed form card',
    alreadyClosed: 'This form is already closed',
  },
};

/**
 * The card payload a client's send stores. A poll card drops the fields only
 * `PollService.close` writes. A sign-up or form card (#3926) is checked and rebuilt
 * from its known fields, because `claim_signup_slots` trusts its slots' ids
 * and limits on every claim; a card that can't be read is refused with a 400
 * rather than stored as a card nobody can sign up on.
 */
function cardPayloadForSend(
  kind: ChatMessageKind,
  payload: Record<string, any> | null | undefined,
): Record<string, any> | null {
  if (kind === 'signup') {
    const checked = normalizeSignupCard(payload);
    if ('error' in checked) throw new BadRequestException(checked.error);
    return { ...checked.card };
  }
  // A form card (#3926 step 3) the same way: the answer route checks every
  // answer against its questions.
  if (kind === 'form') {
    const checked = normalizeFormCard(payload);
    if ('error' in checked) throw new BadRequestException(checked.error);
    return { ...checked.card };
  }
  return withoutServerPollFields(kind, payload);
}

/**
 * An announcement card is drawn with the chapter's official chrome (the
 * megaphone and the "Announcement" label), so only the place that makes a
 * message an announcement may carry one: a timeline post in the announcements
 * channel (`isAnnouncementChannel`), whose who-can-post list `assertChannelAccess`
 * has already checked (#3722). That is the predicate the push worker decides
 * an announcement push by, so the card and the push can't disagree. Anywhere
 * else (`#general`, a DM, a thread under an announcement) the send is refused
 * rather than stored as plain text: `/announce` only ever posts to that
 * channel, so a refusal here is a hand-built request, and quietly changing
 * its kind would hide that from the sender (#3414).
 */
function misplacedAnnouncement(
  kind: ChatMessageKind,
  channel: Pick<ChatChannel, 'name' | 'type' | 'is_read_only'>,
  threadRootId: string | null,
): boolean {
  if (kind !== 'announcement') return false;
  return threadRootId !== null || !isAnnouncementChannel(channel);
}

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
    // Who can see and post (#3722): checks and fills in the two lists.
    private readonly accessLists: ChannelAccessListService,
    private readonly activation: ActivationService,
    private readonly channelCache: ChannelCacheService,
    // Report and block (#2257) live in their own services; the hot path needs
    // only the block list, to mask what it serves.
    private readonly chatBlocks: ChatBlockService,
    // Attachments, avatars and the purge (#1380): every read and write of the
    // chat buckets goes through it. `sendMessage` keeps the ordering.
    private readonly attachments: ChatAttachmentService,
    // `@`-mention resolution, members and roles (2026-11-06).
    private readonly mentions: ChatMentionService,
    // A channel read also clears the chat notifications about it (#3788).
    private readonly notifications: NotificationService,
    // Message threads (#3785): a thread reply's auto-follow and read cursor.
    @Inject(CHAT_THREAD_REPOSITORY)
    private readonly threads: IChatThreadRepository,
    // A forward's copy names the original's author as they were then (#4864).
    @Inject(USER_REPOSITORY)
    private readonly users: IUserRepository,
  ) {}

  // ── Channels ─────────────────────────────────────────────────────────

  /**
   * The chapter's channels, reduced to the ones this caller may read.
   *
   * The filter is load-bearing, not defensive. A channel row carries `name`,
   * `description`, `who_can_see` and `member_ids`, and a DM is
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
      // `warning`: failing open is the design (above), but a read that keeps
      // failing would leave every member's hides ignored with nothing but a
      // log line to show for it (#4096).
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-hidden-channels-read',
        message: `Could not read hidden channels for chapter ${chapterId}; showing them all`,
        error,
      });
      return new Set();
    }
  }

  /**
   * Who can read a channel, for the member list beside it (#3536). The rule
   * and its cost live in `ChannelAccessService.listChannelMembers`.
   */
  listChannelMembers(
    channelId: string,
    chapterId: string,
    userId: string,
  ): Promise<ChannelMemberEntry[]> {
    return this.channelAccess.listChannelMembers(channelId, chapterId, userId);
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
      (input.required_permissions ?? []).length > 0 ||
      input.is_read_only === true
    ) {
      throw new BadRequestException(LEGACY_ACCESS_FIELDS_MESSAGE);
    }

    await this.accessLists.assertCategoryInChapter(
      input.chapter_id,
      input.category_id,
    );

    // Who can see and post (#3722): the lists sent, else the category's.
    // Writes `type` and `is_read_only` to match, which the database checks.
    const access = await this.accessLists.forNewChannel(
      input.chapter_id,
      input.type,
      input.category_id ?? null,
      { who_can_see: input.who_can_see, who_can_post: input.who_can_post },
    );

    return this.channelRepo.create({
      chapter_id: input.chapter_id,
      name: input.name,
      description: input.description ?? null,
      ...access,
      category_id: input.category_id ?? null,
      display_locked: input.display_locked ?? false,
      // Recorded so the creator can set Always formal later without holding
      // `channels:manage` (#3787, `setDisplayLock`).
      created_by: userId,
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
      // membership and `who_can_see` respectively and never consult this column,
      // so populating it there would imply a membership that means nothing.
      // DM and GROUP_DM cannot reach here — they are rejected above and set
      // their own membership in `getOrCreateDm` / `createGroupDm`.
      member_ids: input.type === 'PRIVATE' ? [userId] : null,
    });
  }

  async updateChannel(
    id: string,
    chapterId: string,
    input: UpdateChannelInput,
  ): Promise<ChatChannel> {
    const existing = await this.requireChannelInChapter(id, chapterId);
    // A DM or group DM belongs to its members, not the chapter's officers
    // (#3633): no field of it is a `channels:manage` setting. Refused whole,
    // which also covers the chapter default, Activity and the push default a
    // DM has no use for (the push worker defaults every DM to `all`).
    if (isDirectChannel(existing)) {
      throw new BadRequestException(DIRECT_CHANNEL_SETTINGS_MESSAGE);
    }
    const {
      who_can_see: whoCanSee,
      who_can_post: whoCanPost,
      match_category_access: matchCategoryAccess,
      required_permissions: legacyPermissions,
      is_read_only: legacyReadOnly,
      ...data
    } = input;

    // The audit log (#3909) is the chapter's record of officer changes, so
    // its two defining settings are locked: everyone sees it and only Frapp
    // posts in it (`forChannelUpdate` refuses lists for it), and it keeps
    // its name, which members know it by. The flag (not the name) is what
    // the server keys on, so this is about members finding it, not about the
    // mirror. Description, group and push default stay editable.
    if (existing.is_audit_log) {
      if (legacyReadOnly === false) {
        throw new BadRequestException(
          'The audit log channel is always read-only',
        );
      }
      if (data.name !== undefined && data.name !== existing.name) {
        throw new BadRequestException("The audit log channel can't be renamed");
      }
    }

    if (
      legacyPermissions !== undefined ||
      (legacyReadOnly !== undefined && legacyReadOnly !== existing.is_read_only)
    ) {
      throw new BadRequestException(LEGACY_ACCESS_FIELDS_MESSAGE);
    }

    await this.accessLists.assertCategoryInChapter(chapterId, data.category_id);

    // Who can see and post (#3722). Moving a channel to another category
    // keeps its lists; `match_category_access` copies the category's.
    const access = await this.accessLists.forChannelUpdate(
      chapterId,
      existing,
      {
        who_can_see: whoCanSee,
        who_can_post: whoCanPost,
        match_category_access: matchCategoryAccess,
        category_id: data.category_id,
      },
    );

    // Setting the default goes last, through its own transaction that also
    // unsets the old one, so a save refused above or failing in the update
    // below never leaves the chapter without the default it had.
    const { is_default: isDefault, ...rest } = data;
    const fields = { ...rest, ...access };
    const plain =
      isDefault === false ? { ...fields, is_default: false } : fields;
    let updated =
      Object.keys(plain).length > 0
        ? await this.channelRepo.update(id, chapterId, plain)
        : existing;
    if (isDefault === true && !existing.is_default) {
      updated = (await this.channelRepo.setDefault(id, chapterId)) ?? updated;
    }
    // `who_can_see` is a push-audience authorization input (see
    // `ChannelCacheService`), not display data — evict unconditionally rather
    // than only when that field is present in `data`, so a future field this
    // service starts accepting here can't silently reintroduce the staleness
    // window by omission (#988).
    this.channelCache.invalidate(id);
    return updated;
  }

  /**
   * Turns Always formal on or off (#3787, `spec/behavior/chat/README.md`
   * § Always formal). Allowed for a `channels:manage` holder, which the
   * controller resolves, and for the channel's creator while they can still
   * read it (the route itself needs only chapter membership, so a creator
   * without the permission can reach it). A DM or group DM has no creator in
   * this sense and no officer, so it is refused there.
   */
  async setDisplayLock(
    id: string,
    chapterId: string,
    userId: string,
    hasManagePermission: boolean,
    locked: boolean,
  ): Promise<ChatChannel> {
    // A `channels:manage` holder edits any channel in the chapter, as
    // `updateChannel` does. A creator without it must still be able to read
    // the channel: one removed from their own PRIVATE channel, or who lost a
    // channel's who-can-see list, is refused like any other member, and
    // never gets the row back. Authorization runs before the DM check, so the
    // 400 tells nobody without the right whether an id is a DM.
    const existing = hasManagePermission
      ? await this.requireChannelInChapter(id, chapterId)
      : await this.assertChannelAccess(id, chapterId, userId);
    const isCreator =
      existing.created_by !== null && existing.created_by === userId;
    if (!hasManagePermission && !isCreator) {
      throw new ForbiddenException(
        "Only the channel's creator or a member with channels:manage can set Always formal",
      );
    }
    if (isDirectChannel(existing)) {
      throw new BadRequestException(
        "A DM or group DM can't be set to Always formal",
      );
    }
    if (existing.display_locked === locked) return existing;
    const updated = await this.channelRepo.update(id, chapterId, {
      display_locked: locked,
    });
    this.channelCache.invalidate(id);
    return updated;
  }

  async deleteChannel(id: string, chapterId: string): Promise<void> {
    const existing = await this.requireChannelInChapter(id, chapterId);
    // The audit log (#3909) is the chapter's record of officer changes, and
    // the mirror has nowhere else to post. Refused like a rename; DMs and
    // group DMs belong to their members, so no officer deletes one (#3633).
    if (existing.is_audit_log) {
      throw new BadRequestException("The audit log channel can't be deleted");
    }
    if (isDirectChannel(existing)) {
      throw new BadRequestException("A DM or group DM can't be deleted");
    }
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
      // Hiding marks the DM read, so it clears the notifications about it as
      // a read does (#3788).
      await this.clearChannelNotifications(
        channelId,
        chapterId,
        userId,
        receipt.last_read_at,
      );
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
   *   `operation: "post"` so a channel's who-can-post list decides
   *   (#announcements), and the audit log (`is_audit_log`, #chapter-audit)
   *   refuses every member, the President included (#3909). A quote reply is
   *   a post, so the same gate decides it (#3722).
   * - Cross-channel reply links are rejected before the insert.
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
    sent: SendMessageInput,
  ): Promise<{ message: ChatMessage; deduplicated: boolean }> {
    // The text loses U+FFFC, the placeholder a phone keyboard leaves where a
    // picture or sticker couldn't go, before anything reads it: the emptiness
    // rule, the mentions and the insert all see the cleaned text (#4346).
    // Here rather than in the DTO, so the server's own cards built from a
    // member's typing (a task title, an event name) are cleaned too.
    const input = { ...sent, content: withoutObjectReplacement(sent.content) };
    // Validated before anything else, because the emptiness rule below depends
    // on it: a message that is nothing but a file is a real message.
    const attachments = this.attachments.validateAttachmentInputs(
      input.attachments ?? [],
      input.chapter_id,
      input.channel_id,
    );

    const gif = input.gif ?? null;
    if (gif) {
      if (input.content.trim() || attachments.length > 0) {
        throw new BadRequestException(
          'A GIF message has no text and no attachments',
        );
      }
      if ((input.kind ?? 'text') !== 'text') {
        throw new BadRequestException('Only a plain message can be a GIF');
      }
    } else if (
      !input.content.trim() &&
      attachments.length === 0 &&
      !input.forwarded_from
    ) {
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

    const threadRootId = input.thread_root_id ?? null;
    const channel = await this.assertChannelAccess(
      input.channel_id,
      input.chapter_id,
      input.sender_id,
      // A thread reply authorizes as `thread`, which a read-only channel
      // allows: any reader may thread under an announcement (#3785).
      threadRootId ? 'thread' : 'post',
    );

    const threadRoot = threadRootId
      ? await this.assertThreadRoot(channel, threadRootId, input)
      : null;

    let replyTo: ChatMessage | null = null;
    if (input.reply_to_id) {
      // A quote reply is a post: whoever may post here may quote (#3722),
      // which `assertChannelAccess` above already decided.
      replyTo = await this.messageRepo.findById(input.reply_to_id);
      if (!replyTo || replyTo.channel_id !== input.channel_id) {
        throw new BadRequestException(
          'reply_to_id must reference a message in the same channel',
        );
      }
      // A quote in the timeline cannot point into a thread, whose replies the
      // timeline never shows (#3785).
      if (replyTo.thread_root_id) {
        throw new BadRequestException(
          'reply_to_id cannot reference a reply inside a thread',
        );
      }
    }

    const kind: ChatMessageKind = input.kind ?? 'text';
    // A refusal below that only exists because something changed after the
    // card committed (the module switched off, the announcements channel
    // renamed or opened up) must not refuse that card's replay: answer it as
    // the duplicate below would, or the client's outbox marks a card that
    // exists on the server as failed. Nothing is written on this path, not
    // even the attachment repair.
    const committedReplay = async () => {
      const existing = input.client_message_id
        ? await this.messageRepo.findByClientMessageId(
            input.channel_id,
            input.sender_id,
            input.client_message_id,
          )
        : null;
      return existing && existing.kind === kind
        ? { message: redactDeletedMessage(existing), deduplicated: true }
        : null;
    };

    if (misplacedAnnouncement(kind, channel, threadRootId)) {
      const replay = await committedReplay();
      if (replay) return replay;
      throw new ForbiddenException(
        'Announcements can only be posted in the announcements channel',
      );
    }
    // Before anything is written (thread follows, the attachment repair), so
    // a card that can't be stored costs nothing.
    const payload = cardPayloadForSend(kind, input.payload);

    const gatedModule = MODULE_GATED_KINDS[kind];
    if (
      gatedModule &&
      !isModuleEnabled(input.enabled_modules ?? null, gatedModule)
    ) {
      const replay = await committedReplay();
      if (replay) return replay;
      assertModuleEnabled(input.enabled_modules ?? null, gatedModule);
    }

    // Authoritative, and deliberately not a client responsibility: a mention
    // overrides a per-channel mute in the push rules, so a client-supplied
    // list would let any member force a push to any other member in a channel
    // they had muted on purpose. `ChatMentionService` owns the rules,
    // including that a reply mentions the author it quotes (#3844).
    // Only the picks the cleaned body still writes are read or kept.
    const mentionPicks = mentionPicksIn(
      input.content,
      input.mention_picks ?? [],
    );
    const mentions = await this.mentions.resolveForSend(
      input.chapter_id,
      input.sender_id,
      input.content,
      replyTo,
      mentionPicks,
    );

    // Auto-follow BEFORE the insert, so the push worker, which reacts to the
    // insert, already finds the follows it decides by: the sender (whose own
    // reply re-follows an unfollow, never a mute), the root's author on the
    // first reply only, and everyone mentioned. `ensureFollowing` adds rows
    // only for members with none, so it never undoes a mute or an unfollow.
    // Idempotent, so a retried send that turns out to be a duplicate costs
    // nothing.
    if (threadRoot) {
      await this.threads.followOnReply(
        threadRoot.id,
        input.channel_id,
        input.sender_id,
      );
      const isFirstReply = (threadRoot.thread_reply_count ?? 0) === 0;
      await this.threads.ensureFollowing(threadRoot.id, input.channel_id, [
        ...(isFirstReply && threadRoot.sender_id ? [threadRoot.sender_id] : []),
        ...mentions,
      ]);
    }

    let message: ChatMessage;
    const deduplicated = false;
    try {
      message = await this.messageRepo.create({
        channel_id: input.channel_id,
        sender_id: input.sender_id,
        content: input.content,
        type: 'TEXT',
        kind,
        payload,
        client_message_id: input.client_message_id ?? null,
        reply_to_id: input.reply_to_id ?? null,
        thread_root_id: threadRootId,
        // `attachment_count` is a COUNT, not a copy — `chat_message_attachments`
        // stays the source of truth. It rides on the message row because a
        // `postgres_changes` echo cannot carry a join, so it is the only way a
        // client receiving a live message learns that it should ask for
        // attachments. Without it a file-only message renders as an empty bubble
        // for everyone except its sender. `attachment_photos` rides beside it
        // for the same reason: each photo's size, so a reader draws its box
        // before the attachments read returns (#3879).
        // Both keys are the server's: a client's own copies are dropped, so a
        // text message can't claim files, or photo boxes, it doesn't have.
        metadata: {
          ...clientMetadata(input.metadata),
          ...(attachments.length > 0 ? attachmentMetadataOf(attachments) : {}),
          ...(gif ? { gif } : {}),
          ...(mentionPicks.length > 0 ? { mention_picks: mentionPicks } : {}),
        },
        mentions,
        ...(input.forwarded_from
          ? { forwarded_from: input.forwarded_from }
          : {}),
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
        // Deleted since it committed: answer the tombstone, and repair nothing.
        // Its attachments were purged with it, and re-writing their rows or
        // count would draw dead files on a message that is gone.
        if (existing.is_deleted) {
          return {
            message: redactDeletedMessage(existing),
            deduplicated: true,
          };
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
        // long way round. The photo geometry was cleared with it.
        const restored = await this.messageRepo.update(existing.id, {
          metadata: {
            ...(existing.metadata ?? {}),
            ...attachmentMetadataOf(attachments),
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

    // Your own reply is read: without this the thread you just wrote in would
    // count your reply's predecessors as new. Best-effort, like the channel
    // read's notification clear: a stale count must not fail a committed send.
    if (threadRoot) {
      await this.threads
        .markRead(
          threadRoot.id,
          input.channel_id,
          input.sender_id,
          message.created_at,
        )
        .catch((error: unknown) =>
          reportCaughtFailure(this.logger, {
            level: 'warning',
            site: 'chat-thread-send-marks-read',
            message: `Could not mark thread ${threadRoot.id} read after a send`,
            error,
          }),
        );
    }

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
   * Forward one message to one channel or DM (#4864,
   * spec/behavior/chat/README.md § Forward).
   *
   * The forward is an ordinary text message in the destination, sent by the
   * caller through {@link sendMessage}, so it dedupes on `client_message_id`,
   * resolves the comment's mentions, notifies and counts unread like any
   * post. Its `content` is the caller's comment, which may be empty, and its
   * `forwarded_from` is a copy of the original built here, never taken from
   * the client: the people in the destination may not be able to read the
   * source, so the copy is what they see.
   *
   * - The source must be readable by the caller (404 otherwise, as every
   *   message action answers), and the destination postable (404 / 403 from
   *   {@link sendMessage}'s own check). The destination may be the source's
   *   channel.
   * - Only a live text message is forwarded: a card, a deleted message, or a
   *   forward of a deleted original with no comment is a 400.
   * - A forward of a forward never nests. With no comment of its own (no
   *   text, GIF or files), the source's copy is passed on, so the new
   *   forward still points at the original and follows its deletion.
   *   Otherwise the source itself is copied and its own copy dropped.
   * - Files are not copied: the copy counts them (`attachment_count`).
   *
   * Answers the new message masked for the caller, as a read would serve it,
   * with `deduplicated` set when a retry on the same `client_message_id`
   * answered the forward already made (so its analytics event isn't counted
   * twice, #4875).
   */
  async forwardMessage(input: {
    message_id: string;
    chapter_id: string;
    sender_id: string;
    channel_id: string;
    content?: string | null;
    client_message_id?: string | null;
    mention_picks?: readonly MentionPick[] | null;
  }): Promise<MaskedChatMessage & { deduplicated: boolean }> {
    const source = await this.assertMessageAccess(
      input.message_id,
      input.chapter_id,
      input.sender_id,
    );
    const copy = await this.forwardedCopyOf(source);
    const { message, deduplicated } = await this.sendMessage({
      chapter_id: input.chapter_id,
      channel_id: input.channel_id,
      sender_id: input.sender_id,
      content: input.content ?? '',
      kind: 'text',
      client_message_id: input.client_message_id ?? null,
      mention_picks: input.mention_picks ?? null,
      forwarded_from: copy,
    });
    const masked = await this.maskOne(
      message,
      input.chapter_id,
      input.sender_id,
    );
    return { ...masked, deduplicated };
  }

  /** The copy a forward of `source` carries, or a 400 when it can't be forwarded. */
  private async forwardedCopyOf(
    source: ChatMessage,
  ): Promise<ChatForwardedMessage> {
    const refuse = () =>
      new BadRequestException("This message can't be forwarded");
    if (source.is_deleted || (source.kind ?? 'text') !== 'text') {
      throw refuse();
    }
    const gif = forwardedGifOf(source.metadata?.gif);
    const attachmentCount = attachmentCountOf(source.metadata);
    const inner = source.forwarded_from ?? null;
    if (inner && !source.content.trim() && !gif && attachmentCount === 0) {
      // Nothing of its own to copy: pass the original's copy on.
      if (inner.deleted === true) throw refuse();
      return {
        message_id: inner.message_id,
        channel_id: inner.channel_id,
        sender_id: inner.sender_id ?? null,
        author_name: inner.author_name ?? null,
        content: inner.content ?? '',
        gif: inner.gif ?? null,
        attachment_count: inner.attachment_count ?? 0,
        created_at: inner.created_at,
      };
    }
    return {
      message_id: source.id,
      channel_id: source.channel_id,
      sender_id: source.sender_id,
      author_name: await this.authorNameOf(source),
      content: source.content,
      gif,
      attachment_count: attachmentCount,
      created_at: source.created_at,
    };
  }

  /**
   * The source's author as a reader would name them now: their display name,
   * or the row's own `author_name` for a message with no Frapp user. A failed
   * read leaves it null rather than failing the forward: a reader falls back
   * to the roster by `sender_id`, as it does for any message.
   */
  private async authorNameOf(source: ChatMessage): Promise<string | null> {
    if (!source.sender_id) return source.author_name ?? null;
    try {
      const [identity] = await this.users.findDisplayIdentitiesByIds([
        source.sender_id,
      ]);
      const name = identity?.display_name?.trim();
      return name ? name : (source.author_name ?? null);
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-forward-author-name',
        message: `Could not read the author of message ${source.id}; the forward names no one`,
        error,
      });
      return source.author_name ?? null;
    }
  }

  /**
   * The root of a thread reply: a timeline message in this channel, in a
   * channel that takes threads (#3785, spec/behavior/chat/README.md § Message
   * threads). A thread never nests, a 1:1 DM has no threads in slice 1, and a
   * thread reply is never also a quote-reply.
   */
  private async assertThreadRoot(
    channel: ChatChannel,
    rootId: string,
    input: SendMessageInput,
  ): Promise<ChatMessage> {
    if (!channelAllowsThreads(channel)) {
      throw new BadRequestException('This channel does not take threads');
    }
    if (input.reply_to_id) {
      throw new BadRequestException(
        'A thread reply cannot also quote-reply; send one or the other',
      );
    }
    const root = await this.messageRepo.findById(rootId);
    if (!root || root.channel_id !== channel.id) {
      throw new BadRequestException(
        'thread_root_id must reference a message in the same channel',
      );
    }
    if (root.thread_root_id) {
      throw new BadRequestException(
        'A thread cannot be started on a thread reply',
      );
    }
    // An imported archive row is hard-deleted when its import is purged, and
    // the purge would take the members' replies with it (the foreign key
    // cascades). Threading imported history is slice 3 (#3785).
    if (root.kind === 'imported') {
      throw new BadRequestException('An imported message cannot be threaded');
    }
    return root;
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
    operation: 'read' | 'post' | 'thread' = 'read',
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
    operation: 'read' | 'post' | 'thread' = 'read',
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

  /**
   * Who wrote the message a reply quotes, for an edit to keep the reply's
   * ping (`ChatMentionService.resolveForEdit`). `null` when it quotes
   * nothing, and `undefined` when the read fails: an edit must not fail, or
   * drop a ping it cannot check, for a lookup that only decides the ping.
   */
  private async quotedAuthorId(
    replyToId: string | null,
  ): Promise<string | null | undefined> {
    if (!replyToId) return null;
    try {
      const quoted = await this.messageRepo.findById(replyToId);
      return quoted?.sender_id ?? null;
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-edit-quoted-author',
        message: `Failed to read the message ${replyToId} a reply quotes; the edit keeps its stored mentions`,
        error,
      });
      return undefined;
    }
  }

  async editMessage(
    messageId: string,
    chapterId: string,
    senderId: string,
    content: string,
    picked: readonly MentionPick[] = [],
  ): Promise<ChatMessage> {
    // Ownership alone is not enough: a member removed from another chapter
    // would still pass the sender check on their historical messages there.
    // Authorized as a "post" — an edit writes new member-authored content into
    // the channel, so it must clear the same gates as sending. Otherwise an
    // alumnus (or a member in a read-only channel) could rewrite an older
    // message of theirs to arbitrary text and broadcast it.
    //
    // A thread reply re-authorizes as `thread`, the operation it was written
    // under (#3785): a member may reply in a thread under an announcement, so
    // `post`'s read-only gate would let them write a reply they can never
    // fix. Read first to learn which; the archive, audit-log and alumni rules
    // apply to both.
    const seen = await this.assertMessageAccess(messageId, chapterId, senderId);
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      senderId,
      seen.thread_root_id ? 'thread' : 'post',
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

    // A card's body is its payload, and its `content` is the line a push,
    // the channel preview and search read for it (a form's or sign-up's
    // title, a poll's question): not the member's words to edit. The clients
    // hide Edit on every card (`CARD_KINDS` in `@repo/chat-core`); this is the
    // rule, so an edit can't make that line disagree with the card.
    if ((message.kind ?? 'text') !== 'text') {
      throw new BadRequestException('A card cannot be edited');
    }

    // A GIF message is the GIF, with no text to change (#4631); the clients
    // hide Edit on it (`canEditMessage`), and this is the rule.
    if (message.metadata && 'gif' in message.metadata) {
      throw new BadRequestException('A GIF cannot be edited');
    }

    // Cleaned as a send is (#4346). An edit has no attachments to stand in for
    // text, so one that is blank once cleaned is refused here, in words a
    // member can act on, as a blank send is.
    content = withoutObjectReplacement(content);
    if (!content.trim()) {
      throw new BadRequestException('An edited message needs some text');
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
    //
    // A reply's ping of the author it quotes (#3844) is not re-resolved: the
    // edit keeps it exactly as the send stored it, since the reply still
    // quotes them (`ChatMentionService.resolveForEdit`).
    //
    // The picks the message was sent with are kept (#3835): a client sends
    // only the ones made in this edit, and an old client none, so without the
    // stored ones an edit would read a picked `@Jane Doe` whose member has
    // since left as `@Jane`, and hand it to whoever is the only Jane now.
    const storedPicks = readMentionPicks(message.metadata?.mention_picks);
    const mentionPicks = mentionPicksIn(content, [...picked, ...storedPicks]);
    const mentions = await this.mentions.resolveForEdit(
      chapterId,
      senderId,
      content,
      message.mentions ?? [],
      await this.quotedAuthorId(message.reply_to_id ?? null),
      message.content ?? '',
      { previous: storedPicks, next: mentionPicks },
    );

    const edited = await this.messageRepo.update(messageId, {
      content,
      mentions,
      // Written only when there are picks to keep or to drop, so an ordinary
      // edit leaves the row's metadata as it was.
      ...(storedPicks.length > 0 || mentionPicks.length > 0
        ? { metadata: withPicks(message.metadata, mentionPicks) }
        : {}),
      edited_at: new Date().toISOString(),
    });
    await this.rewriteNotificationsForEdit(edited, chapterId, senderId);
    return edited;
  }

  /**
   * The in-app rows this message produced quote its old text (#4418). Only
   * members who can still read the channel get the new text: a row its owner
   * kept after losing access holds only what they were sent while they had
   * it, and an edit must not hand them more. Best-effort, like the rewrite
   * itself: the edit has landed, so a failed reader lookup is reported and
   * leaves the old text.
   */
  private async rewriteNotificationsForEdit(
    edited: ChatMessage,
    chapterId: string,
    editorId: string,
  ): Promise<void> {
    let readerIds: string[];
    try {
      const readers = await this.channelAccess.listChannelMembers(
        edited.channel_id,
        chapterId,
        editorId,
      );
      readerIds = readers.map((r) => r.user_id);
    } catch (err) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-edit-notification-readers',
        message: `Could not resolve the readers of channel ${edited.channel_id} to rewrite the notifications for edited message ${edited.id}`,
        error: err,
      });
      return;
    }
    await this.notifications.rewriteChatMessagePreview(
      chapterId,
      edited.id,
      chatPushPreview(edited),
      readerIds,
    );
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

    if (
      message.sender_id !== requesterId &&
      !hasManagePermission &&
      !isAskAnswerPostedBy(message, requesterId)
    ) {
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
    message: Pick<ChatMessage, 'id' | 'kind' | 'metadata' | 'payload'>,
    chapterId: string,
  ): Promise<ChatMessage> {
    const messageId = message.id;
    const deleted = await this.messageRepo.update(messageId, {
      content: DELETED_MESSAGE_CONTENT,
      is_deleted: true,
      metadata: tombstoneMetadata(message),
      // A card's data lives here (an event's name and place, a poll's
      // question and options, a task's fields), so a delete that left it
      // would remove only the words around it (#1575). Cleared, not kept for
      // an undelete: there is none, and an officer's removal of a reported
      // card has to remove what was reported. `maskBlockedMessages` strips it
      // on read too, for rows deleted before this cleared it. An imported
      // row keeps only its Discord handle (`tombstonePayload`).
      payload: tombstonePayload(message),
      // A flag labels content that is now gone (#3921), and a deleted
      // message must not keep raising the Important strip.
      flag: null,
      flagged_by: null,
      flagged_at: null,
      // A deleted forward keeps nothing of the copy it carried (#4864).
      forwarded_from: null,
    });
    // The in-app notifications that quote the message go in the same
    // statement: `chat_messages_forget_notifications` deletes every row whose
    // `chat_message_id` is this message as `is_deleted` turns true (#4418).

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

    return redactDeletedMessage(deleted);
  }

  // ── Flags (#3921) ────────────────────────────────────────────────────

  /**
   * Put `flag` on a message, or replace the one it carries.
   *
   * Anyone who can read the channel may flag a message that has none; once it
   * is flagged, only its sender, whoever added the flag, or a
   * `channels:manage` holder may replace it (`canChangeMessageFlag` in
   * `@repo/validation`, which the clients share). Authorized as a read, like
   * a reaction: a flag adds no content, so a read-only channel or an alumnus
   * may still flag (spec/behavior/chat/README.md § Message flags).
   *
   * The write is a compare-and-set on the flag and flagger the check was made
   * against, and on the message still being live, so two members flagging the
   * same unflagged message at once cannot both win, and the loser, who may
   * not be allowed to replace the winner's flag, gets a 409 rather than
   * silently overwriting it. A delete that lands mid-request is a 409 too.
   *
   * The answer is masked for the caller like any message read, since the
   * caller may have blocked the sender.
   */
  async setMessageFlag(
    messageId: string,
    chapterId: string,
    userId: string,
    hasManagePermission: boolean,
    flag: ChatMessageFlag,
  ): Promise<MaskedChatMessage> {
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );
    if (message.is_deleted) {
      throw new BadRequestException('Cannot flag a deleted message');
    }
    if (message.flag === flag) {
      return this.maskOne(message, chapterId, userId);
    }
    this.assertMayChangeFlag(message, userId, hasManagePermission);

    const updated = await this.messageRepo.compareAndSetFlag(
      messageId,
      {
        flag: message.flag ?? null,
        flagged_by: message.flagged_by ?? null,
        requireLive: true,
      },
      { flag, flagged_by: userId, flagged_at: new Date().toISOString() },
    );
    if (!updated) throw this.flagRaceConflict();
    return this.maskOne(updated, chapterId, userId);
  }

  /** Take a message's flag off. Idempotent; same rule as replacing one. */
  async clearMessageFlag(
    messageId: string,
    chapterId: string,
    userId: string,
    hasManagePermission: boolean,
  ): Promise<MaskedChatMessage> {
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );
    if (message.flag == null) {
      return this.maskOne(message, chapterId, userId);
    }
    this.assertMayChangeFlag(message, userId, hasManagePermission);

    // No `requireLive`: a tombstone that still carries a flag (one deleted
    // while an API without this rule was serving) must stay clearable.
    const updated = await this.messageRepo.compareAndSetFlag(
      messageId,
      {
        flag: message.flag,
        flagged_by: message.flagged_by ?? null,
        requireLive: false,
      },
      { flag: null, flagged_by: null, flagged_at: null },
    );
    if (!updated) throw this.flagRaceConflict();
    return this.maskOne(updated, chapterId, userId);
  }

  private assertMayChangeFlag(
    message: ChatMessage,
    userId: string,
    hasManagePermission: boolean,
  ): void {
    if (
      !canChangeMessageFlag(
        {
          sender_id: message.sender_id,
          flagged_by: message.flagged_by ?? null,
          flag: message.flag ?? null,
        },
        userId,
        hasManagePermission,
      )
    ) {
      throw new ForbiddenException(
        'Only the sender, whoever added the flag, or an officer can change it',
      );
    }
  }

  private flagRaceConflict(): ConflictException {
    return new ConflictException(
      'This message’s flag changed, or the message was deleted, just now. Reload and try again.',
    );
  }

  private async maskOne(
    message: ChatMessage,
    chapterId: string,
    userId: string,
  ): Promise<MaskedChatMessage> {
    const blocked = await this.chatBlocks.listBlockedUserIds(chapterId, userId);
    return maskBlockedMessages([message], blocked)[0];
  }

  // ── Sign-up cards (#3926) ────────────────────────────────────────────

  /**
   * Close a sign-up card (#3926 step 2) or a form card (step 3) early, as
   * `PollService.closeCard` closes a poll card: its creator may, whatever
   * their permissions now, and so may a `channels:manage` holder
   * (`canModerate`, asked only when the caller isn't the creator). Channel
   * access is a `close`: read access, with archive and the audit log refusing
   * it, but not who can post, so a card whose creator lost post rights can
   * still be closed.
   *
   * Stamps `payload.closed_at` / `closed_by`, which `ChatService.sendMessage`
   * never takes from a client (`normalizeSignupCard` and `normalizeFormCard`
   * rebuild the card). The row update reaches every open card as a Realtime
   * UPDATE; `claim_signup_slots` and `ChatFormService.saveResponse` refuse
   * every answer once it is set. Answers already made stay.
   */
  async closeCard(
    messageId: string,
    chapterId: string,
    userId: string,
    canModerate: () => Promise<boolean> = () => Promise.resolve(false),
  ): Promise<ChatMessage> {
    const message = await this.messageRepo.findById(messageId);
    if (!message) throw new NotFoundException('Message not found');
    await this.channelAccess.assertChannelAccess(
      message.channel_id,
      chapterId,
      userId,
      'close',
    );
    const copy = CLOSE_COPY[message.kind as 'signup' | 'form'];
    if (!copy) {
      throw new BadRequestException('Message is not a sign-up or form card');
    }
    if (message.is_deleted) {
      throw new BadRequestException(copy.deleted);
    }
    if (message.sender_id !== userId && !(await canModerate())) {
      throw new ForbiddenException(copy.forbidden);
    }
    const payload = message.payload;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new BadRequestException(copy.malformed);
    }
    if (isCardClosed(payload)) {
      throw new BadRequestException(copy.alreadyClosed);
    }
    return stampCardClosed(
      this.messageRepo,
      message,
      payload as Record<string, unknown>,
      userId,
      copy.deleted,
    );
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

    // Nothing to elevate, and pinning a tombstone would make it the
    // channel's durable, prominent row (#1575).
    if (message.is_deleted) {
      throw new BadRequestException('Cannot pin a deleted message');
    }

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

    return redactDeletedMessage(
      await this.messageRepo.update(messageId, {
        is_pinned: false,
        pinned_at: null,
      }),
    );
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

  /**
   * Stamp the caller's read receipt, then clear the chat notifications the
   * read covers (#3788): the inbox row for a message is "viewed" once its
   * channel is, however the member got there.
   */
  async markChannelRead(channelId: string, chapterId: string, userId: string) {
    await this.assertChannelAccess(channelId, chapterId, userId);
    const readAt = new Date().toISOString();
    const receipt = await this.readReceiptRepo.upsert(
      channelId,
      userId,
      readAt,
    );
    await this.clearChannelNotifications(channelId, chapterId, userId, readAt);
    return receipt;
  }

  /**
   * Mark unread (#3723): move the caller's read cursor in the message's
   * channel back to just before it, so it and everything after it count as
   * unread again, as Discord's and Slack's Mark unread do. One millisecond
   * before, because a `Date` holds milliseconds and the column microseconds:
   * the cursor lands strictly before the message, which is what makes it
   * count (`get_channel_unread_counts` counts `created_at > last_read_at`).
   *
   * A timeline message only. A thread reply never counts toward its channel
   * (#3785), so moving the channel's cursor to it would mark the wrong
   * things unread; a deleted message has nothing to come back to. The chat
   * notifications the read cleared stay cleared: the badge is the reminder.
   */
  async markMessageUnread(
    messageId: string,
    chapterId: string,
    userId: string,
  ) {
    const message = await this.assertMessageAccess(
      messageId,
      chapterId,
      userId,
    );
    if (message.thread_root_id) {
      throw new BadRequestException(
        "A thread reply can't be marked unread in its channel",
      );
    }
    if (message.is_deleted) {
      throw new BadRequestException("A deleted message can't be marked unread");
    }
    const before = new Date(Date.parse(message.created_at) - 1).toISOString();
    return this.readReceiptRepo.upsert(message.channel_id, userId, before);
  }

  /**
   * Mark the caller's chat notifications for a channel read, through the
   * instant its receipt now reads (#3788). Awaited, so a client's refetch
   * after the request sees the rows cleared, but best-effort: a failed clear
   * leaves a stale dot in the inbox, which must not fail the read receipt
   * that drives every unread badge.
   */
  private async clearChannelNotifications(
    channelId: string,
    chapterId: string,
    userId: string,
    readThrough: string,
  ): Promise<void> {
    try {
      await this.notifications.markChatChannelNotificationsRead(
        userId,
        chapterId,
        channelId,
        readThrough,
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'chat-read-clears-notifications',
        message: `Could not clear chat notifications for channel ${channelId}`,
        error,
      });
    }
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

  /**
   * Each readable channel's latest message, for Chat home's row previews.
   *
   * Filtered exactly as `getUnreadCounts` is, and for the same reason: the RPC
   * answers for every channel in the chapter, and a preview would reveal far
   * more than a count does about a DM between two other members. A DM the
   * caller hid has no row to preview, so it is left out too.
   */
  async getLatestMessages(
    chapterId: string,
    userId: string,
  ): Promise<ChannelLatestMessage[]> {
    const rows = await this.messageRepo.findLatestPerChannel(chapterId, userId);
    if (rows.length === 0) return [];
    const [accessible, hidden] = await Promise.all([
      this.channelAccess.filterAccessibleChannelIds(
        chapterId,
        userId,
        rows.map((row) => row.channel_id),
      ),
      this.findHiddenChannelIds(chapterId, userId),
    ]);
    return rows.filter(
      (row) => accessible.has(row.channel_id) && !hidden.has(row.channel_id),
    );
  }
}

/**
 * A GIF message's `metadata.gif`, as a forward's copy carries it (#4864), or
 * null when there is none or it isn't the shape `GifService.messageGif`
 * writes.
 */
function forwardedGifOf(gif: unknown): ChatForwardedGif | null {
  if (!gif || typeof gif !== 'object') return null;
  const g = gif as Record<string, unknown>;
  if (
    typeof g.provider !== 'string' ||
    typeof g.id !== 'string' ||
    typeof g.url !== 'string' ||
    typeof g.width !== 'number' ||
    typeof g.height !== 'number'
  ) {
    return null;
  }
  return {
    provider: g.provider,
    id: g.id,
    title: typeof g.title === 'string' ? g.title : '',
    url: g.url,
    width: g.width,
    height: g.height,
  };
}

/** `metadata.attachment_count` when it is a whole positive number, else 0. */
function attachmentCountOf(
  metadata: Record<string, unknown> | null | undefined,
): number {
  const raw = metadata?.attachment_count;
  return typeof raw === 'number' && Number.isInteger(raw) && raw > 0 ? raw : 0;
}

/** `metadata` with its `mention_picks` replaced by `picks`, or dropped when none (#3835). */
function withPicks(
  metadata: Record<string, any> | null | undefined,
  picks: readonly MentionPick[],
): Record<string, any> {
  const next: Record<string, any> = { ...(metadata ?? {}) };
  delete next.mention_picks;
  if (picks.length > 0) next.mention_picks = picks;
  return next;
}

/**
 * A send's own `metadata`, without the keys only the server stamps.
 * `attachment_count` and `attachment_photos` describe the attachment rows, so
 * they come from `attachmentMetadataOf`, never the client: a forged count
 * drew a placeholder per claimed file on every reader (#3879 review).
 */
function clientMetadata(
  metadata: Record<string, any> | undefined,
): Record<string, any> {
  const own = { ...(metadata ?? {}) };
  delete own.attachment_count;
  delete own.attachment_photos;
  // The server's own too (#4631): a GIF's URL is checked against the
  // provider's media host on the way in, so a client can't write one here.
  delete own.gif;
  // And the picks (#3835), which arrive as `mention_picks` and are kept only
  // where the body still writes them: a client's own copy here would pin a
  // token to a member the send never checked.
  delete own.mention_picks;
  return own;
}
