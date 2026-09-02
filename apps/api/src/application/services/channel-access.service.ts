import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CHAT_CHANNEL_REPOSITORY,
  CHAT_MESSAGE_REPOSITORY,
} from '../../domain/repositories/chat.repository.interface';
import type {
  IChatChannelRepository,
  IChatMessageRepository,
} from '../../domain/repositories/chat.repository.interface';
import { MEMBER_REPOSITORY } from '../../domain/repositories/member.repository.interface';
import type { IMemberRepository } from '../../domain/repositories/member.repository.interface';
import type {
  ChatChannel,
  ChatChannelView,
  ChatMessage,
} from '../../domain/entities/chat.entity';
import { canAccessChannel, isAlumniPostableChannel } from '@repo/validation';
import type { ChannelOperation } from '@repo/validation';
import { RbacService } from './rbac.service';

/**
 * The projection `canAccessChannel` decides on. Spelled once so the single-read
 * path and the batch path cannot drift: adding a gating field to the predicate
 * and wiring it into only one call site would let the list admit a channel the
 * single read denies, which is precisely the asymmetry #1001 was.
 */
function toPredicateChannel(channel: ChatChannel) {
  return {
    type: channel.type,
    member_ids: channel.member_ids,
    required_permissions: channel.required_permissions,
    is_read_only: channel.is_read_only ?? null,
    archived_at: channel.archived_at,
  };
}

/**
 * Single source of truth for chat channel-level authorization. Both the chat
 * hot path (`ChatService`) and the poll surface (`PollService`) authorize
 * through this service so the two cannot drift: every read / send / vote is
 * decided by the shared `canAccessChannel` predicate against the same
 * channel + membership + effective-permissions lookups.
 *
 * Channel-level visibility (PUBLIC / PRIVATE / ROLE_GATED / DM / GROUP_DM) is
 * decided by `canAccessChannel`, which the retired Edge Functions also reused.
 */
@Injectable()
export class ChannelAccessService {
  constructor(
    @Inject(CHAT_CHANNEL_REPOSITORY)
    private readonly channelRepo: IChatChannelRepository,
    @Inject(CHAT_MESSAGE_REPOSITORY)
    private readonly messageRepo: IChatMessageRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Resolve a channel within the caller's chapter and assert the caller may
   * `read` or `post` to it. A channel in another chapter resolves to a 404
   * (the chapter scope holds); a channel the caller cannot see/post to
   * resolves to a 403. Returns the channel so callers can reuse it.
   */
  async assertChannelAccess(
    channelId: string,
    chapterId: string,
    userId: string,
    operation: ChannelOperation = 'read',
  ): Promise<ChatChannel> {
    const channel = await this.channelRepo.findById(channelId, chapterId);
    if (!channel) {
      throw new NotFoundException('Channel not found');
    }

    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    const isChapterMember = Boolean(member);

    // Alumni are read-mostly (`spec/behavior/alumni.md`): resolve the lifecycle
    // flag only when it can change the outcome — an authored post into a
    // channel alumni are not allowed to write in. Reads, votes, and posts into
    // alumni-postable channels (DMs, and ROLE_GATED channels requiring
    // `alumni:post`) skip the lookup, so the chat hot path adds no query for
    // them. Must use the same predicate the gate does, or the short-circuit
    // would skip the lookup on the ROLE_GATED channels that now need it.
    // Reuses the member row already fetched above rather than re-querying it.
    const alumniRuleCouldApply =
      isChapterMember &&
      operation === 'post' &&
      !isAlumniPostableChannel({
        type: channel.type,
        member_ids: channel.member_ids,
        required_permissions: channel.required_permissions,
      });
    const isAlumni = alumniRuleCouldApply
      ? await this.rbac.hasAlumniRole(chapterId, member?.role_ids)
      : false;

    // For a write against a read-only channel (#announcements, #chapter-audit)
    // we need to evaluate the caller's permissions even on a PUBLIC channel
    // so the announcements:post gate can fire. Alumni posts need them too, so
    // a President who also carries the Alumni role still bypasses (wildcard).
    const needsPermissions =
      isChapterMember &&
      (channel.type === 'ROLE_GATED' ||
        (operation !== 'read' && channel.is_read_only === true) ||
        isAlumni);
    const permissions = needsPermissions
      ? await this.rbac.getEffectivePermissions(chapterId, userId)
      : [];

    const allowed = canAccessChannel({
      channel: toPredicateChannel(channel),
      userId,
      isChapterMember,
      permissions,
      operation,
      isAlumni,
    });

    if (!allowed) {
      throw new ForbiddenException('You do not have access to this channel');
    }

    return channel;
  }

  /**
   * Authorize a caller for a **message** by resolving message → channel →
   * chapter, then delegating to {@link assertChannelAccess}. A message in a
   * channel the caller cannot see (or in another chapter) is rejected.
   *
   * `operation` defaults to `'read'`, which is right for actions that don't
   * author channel content (delete, pin, react, vote, bookmark). Pass `'post'`
   * for anything that writes member-authored content into the channel —
   * otherwise the post-side gates (read-only channels, the Alumni lifecycle
   * rule) are bypassed by editing an existing message instead of sending a new
   * one.
   *
   * Lives here, beside `assertChannelAccess`, for the reason that method's own
   * docblock gives: more than one surface authorizes a message now (`ChatService`
   * for pin/delete/react, `ChatBookmarkService` for bookmarks), and two copies of
   * a message-level authorization helper is exactly the drift this service
   * exists to prevent. `ChatService` keeps a thin private delegate so its call
   * sites read unchanged.
   */
  async assertMessageAccess(
    messageId: string,
    chapterId: string,
    userId: string,
    operation: ChannelOperation = 'read',
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

  /**
   * Reduce a set of channel ids to those the caller may `read`, decided by the
   * shared predicate. Mirrors the batch pattern used by search so a chapter-wide
   * list (e.g. `GET /v1/polls`) cannot become a side-channel that leaks the
   * content of private, DM, or role-gated channels the caller is not in.
   *
   * Loads channels, membership, and effective permissions at most once each;
   * permissions are only fetched when a ROLE_GATED channel is among the
   * candidates. Membership resolves *before* the channel load so a caller from
   * outside the chapter never triggers a chapter-wide read.
   */
  async filterAccessibleChannelIds(
    chapterId: string,
    userId: string,
    channelIds: string[],
    options: { includeArchived?: boolean } = {},
  ): Promise<Set<string>> {
    const wanted = new Set(channelIds);
    if (wanted.size === 0) return new Set();

    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) return new Set();

    const channels = await this.channelRepo.findByChapter(chapterId);
    // Mirrors `filterAccessibleChannels`' archived exclusion (#348) — this is
    // the other batch predicate `getUnreadCounts` and the chapter-wide poll
    // list go through, and the two must not drift on what counts as active.
    //
    // `includeArchived` exists because "is this channel in my active list?" and
    // "may I read this channel?" are different questions, and #348 answers them
    // differently: an archived Group DM leaves the active list but stays
    // *readable* by whoever remains in `member_ids` (`canAccessChannel` denies
    // only the post). Every caller above wants the first question. Bookmarks
    // (#462) want the second — a member who saved a message in a Group DM that
    // later archived has not lost the right to read it, and treating the
    // archive as a revocation would redact rows they can still open in the
    // timeline. Defaults to the active-list meaning so no existing caller
    // changes.
    const candidates = channels.filter(
      (channel) =>
        wanted.has(channel.id) &&
        (options.includeArchived || !channel.archived_at),
    );
    if (candidates.length === 0) return new Set();

    const accessible = await this.applyReadPredicate(
      chapterId,
      userId,
      candidates,
    );
    return new Set(accessible.map((channel) => channel.id));
  }

  /**
   * The array-taking half of the same guarantee, for callers that have already
   * loaded the rows. `GET /v1/channels` *is* the chapter's channel list, so
   * resolving its ids back into rows through `filterAccessibleChannelIds` would
   * read `chat_channels` twice on every request.
   *
   * A channel row is not neutral metadata: `name`, `description`,
   * `required_permissions` and `member_ids` together describe who is talking to
   * whom, and a DM is server-named `dm-<userA>-<userB>`, so an unfiltered
   * chapter-wide list publishes the whole private and direct-message graph.
   * Filtering here is load-bearing, not defensive.
   *
   * Rows are re-scoped to `chapterId` before the predicate runs. The id-taking
   * sibling gets that for free by loading its own candidates; here the rows come
   * from the caller, and `applyReadPredicate` asserts `isChapterMember: true` on
   * the strength of a membership check against `chapterId` alone — which proves
   * the *caller* belongs to the chapter, not the *channels*. Without this filter
   * a caller passing rows from anywhere else (a by-id resolver, a join over
   * messages) would have every foreign `PUBLIC` row returned as accessible.
   */
  async filterAccessibleChannels(
    chapterId: string,
    userId: string,
    channels: ChatChannel[],
  ): Promise<ChatChannel[]> {
    // An archived GROUP_DM (#348 — membership dropped to <= 1 via leave)
    // drops out of the active list here — mirrored in `filterAccessibleChannelIds`
    // below, this method's sibling — rather than at `findByChapter`: a
    // direct-by-id fetch (re-leaving, or reading history) still resolves it.
    // Writing into an archived channel is separately denied for everyone by
    // `canAccessChannel` itself (the `archived_at` check on a write
    // operation), so this exclusion is about list membership, not authority.
    const inChapter = channels.filter(
      (channel) => channel.chapter_id === chapterId && !channel.archived_at,
    );
    if (inChapter.length === 0) return [];

    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (!member) return [];

    return this.applyReadPredicate(chapterId, userId, inChapter);
  }

  /**
   * Annotate already-readable channels with `can_post`, decided by the same
   * `canAccessChannel` predicate the write path (`assertChannelAccess`)
   * enforces — so a client's composer state and the server's actual gate
   * cannot drift. #704: surfaces the alumni-post restriction (and the
   * existing read-only-without-`announcements:post` case) as one capability
   * flag instead of shipping the caller's raw alumni status.
   *
   * Callers must have already filtered to channels the caller may `read`
   * (`filterAccessibleChannels` / `assertChannelAccess`) — this only adds the
   * post-capability projection on top, it does not itself decide visibility.
   */
  async withPostCapability(
    chapterId: string,
    userId: string,
    channels: ChatChannel[],
  ): Promise<ChatChannelView[]> {
    if (channels.length === 0) return [];

    // Same short-circuit `assertChannelAccess` uses: skip the Alumni-role
    // lookup entirely when every candidate is alumni-postable by construction
    // (DMs, GROUP_DMs), so a chapter with no alumni carries no extra query.
    const needsAlumniLookup = channels.some(
      (channel) => !isAlumniPostableChannel(toPredicateChannel(channel)),
    );
    const isAlumni = needsAlumniLookup
      ? await this.rbac.isAlumni(chapterId, userId)
      : false;

    // `|| isAlumni` matters here for the same reason it does in
    // `assertChannelAccess`: an alumni caller who ALSO holds `*` (President)
    // bypasses the restriction (spec/behavior/alumni.md — "a chapter cannot
    // lock itself out by assigning the Alumni role to its own President"),
    // and that bypass is decided inside `canAccessChannel` by checking
    // `permissions.includes('*')`. Without this clause, an alumni President
    // posting in an ordinary PUBLIC channel would compute `permissions: []`
    // (not ROLE_GATED, not read-only), so the wildcard check would never see
    // `*` and `can_post` would come back `false` for a caller whose actual
    // send succeeds — the exact client/server drift this method exists to
    // prevent.
    const needsPermissions = channels.some(
      (channel) =>
        channel.type === 'ROLE_GATED' ||
        channel.is_read_only === true ||
        isAlumni,
    );
    const permissions = needsPermissions
      ? await this.rbac.getEffectivePermissions(chapterId, userId)
      : [];

    return channels.map((channel) => ({
      ...channel,
      can_post: canAccessChannel({
        channel: toPredicateChannel(channel),
        userId,
        isChapterMember: true,
        permissions,
        operation: 'post',
        isAlumni,
      }),
    }));
  }

  /**
   * Shared predicate loop for both batch entry points. The caller has already
   * proven chapter membership, so `isChapterMember` holds by construction, and
   * permissions are resolved only when a ROLE_GATED candidate can consume them.
   */
  private async applyReadPredicate(
    chapterId: string,
    userId: string,
    candidates: ChatChannel[],
  ): Promise<ChatChannel[]> {
    const needsPermissions = candidates.some(
      (channel) => channel.type === 'ROLE_GATED',
    );
    const permissions = needsPermissions
      ? await this.rbac.getEffectivePermissions(chapterId, userId)
      : [];

    return candidates.filter((channel) =>
      canAccessChannel({
        channel: toPredicateChannel(channel),
        userId,
        isChapterMember: true,
        permissions,
        operation: 'read',
      }),
    );
  }
}
