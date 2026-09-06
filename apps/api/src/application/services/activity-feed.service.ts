import { Injectable, Logger } from '@nestjs/common';
import { can } from '@repo/validation';
import { EventService } from './event.service';
import { PointsService } from './points.service';
import { BackworkService } from './backwork.service';
import { MemberService } from './member.service';
import { ChatService } from './chat.service';
import { RbacService } from './rbac.service';
import { SystemPermissions } from '#domain/constants/permissions';

export type ActivityFeedItemType =
  | 'event_created'
  | 'event_upcoming'
  | 'points_change'
  | 'backwork_upload'
  | 'member_joined'
  | 'announcement';

export interface ActivityFeedActor {
  user_id: string;
  display_name: string;
  avatar_url: string | null;
}

/**
 * One normalized row of `spec/behavior/activity-feed.md`'s unified feed.
 *
 * `target_id` is the underlying record's id (event id, point-transaction id,
 * backwork resource id, the joining member's `user_id`, or the announcement
 * channel id) so a client can route to it — this DTO never carries enough of
 * the source record to render a full detail view itself, only a feed row.
 */
export interface ActivityFeedItem {
  id: string;
  type: ActivityFeedItemType;
  timestamp: string;
  title: string;
  body: string | null;
  actor: ActivityFeedActor | null;
  target_id: string;
}

/** How many rows each domain may contribute before the merged list is capped to the caller's `limit`. */
const PER_DOMAIN_LIMIT = 10;
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 50;
/** How many extra announcement rows to fetch, to absorb soft-deleted ones filtered out afterward — see {@link ActivityFeedService['announcementItems']}. */
const ANNOUNCEMENT_FETCH_BUFFER = 3;
/** "New event created" only surfaces events created within this window — otherwise a chapter's entire history reads as "new" forever. */
const EVENT_CREATED_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Sort by a timestamp field, newest first (or oldest first with
 * `ascending: true`), and take the first `limitN`. Shared by every domain
 * below so a future change to the tie-break rule can't drift between them.
 */
function topByDate<T>(
  items: readonly T[],
  timestampOf: (item: T) => string,
  limitN: number,
  ascending = false,
): T[] {
  const sorted = [...items].sort((a, b) => {
    const diff =
      new Date(timestampOf(a)).getTime() - new Date(timestampOf(b)).getTime();
    return ascending ? diff : -diff;
  });
  return sorted.slice(0, limitN);
}

/**
 * Look up the actor behind a row by user id, roster-first.
 *
 * A `null` `user_id` (no `sender_id` on an imported chat message) has no
 * actor. A `user_id` not found in the current roster — a member who has
 * since left the chapter — still gets a row with an empty `display_name`
 * rather than being dropped: `MemberRosterEntry`'s own convention is that an
 * empty name is the real "unresolved" signal for a client to fall back on
 * (e.g. `memberFallbackLabel` in `@repo/hooks`), not something the server
 * invents a placeholder for or silently erases.
 */
function actorFromRoster(
  userId: string | null | undefined,
  roster: Map<string, ActivityFeedActor>,
): ActivityFeedActor | null {
  if (!userId) return null;
  return (
    roster.get(userId) ?? {
      user_id: userId,
      display_name: '',
      avatar_url: null,
    }
  );
}

/**
 * Aggregates the five domains `spec/behavior/activity-feed.md` names into one
 * ordered feed — read-only, no separate feed table; every row is assembled
 * from each domain's own already-guarded service, never a raw table scan.
 *
 * Each domain call carries its own visibility rule rather than one blanket
 * chapter scan, because the five domains do not share one:
 * - Points: {@link PointsService.getUserSummary} is already caller-scoped —
 *   the spec says "own" point changes, and `listTransactions` (chapter-wide)
 *   is gated behind `POINTS_VIEW_ALL`, which most members do not hold.
 * - Backwork: its controller requires `BACKWORK_UPLOAD` or `BACKWORK_ADMIN`,
 *   stricter than the `MEMBERS_VIEW` this feed itself is gated on, so backwork
 *   rows are included only when the caller's own effective permissions carry
 *   one of the two — never unconditionally unioned in.
 * - Announcements: resolved via {@link ChatService.getChannels}, which
 *   filters to channels the caller can access, so an ungated `chat_messages`
 *   scan never happens here.
 *
 * The five domain fetches run independently ({@link Promise.allSettled}, not
 * `Promise.all`): a transient failure in one (a DB hiccup fetching backwork,
 * say) degrades that domain to an empty contribution and is logged, rather
 * than 500ing a feed the other four domains already had a good answer for.
 */
@Injectable()
export class ActivityFeedService {
  private readonly logger = new Logger(ActivityFeedService.name);

  constructor(
    private readonly eventService: EventService,
    private readonly pointsService: PointsService,
    private readonly backworkService: BackworkService,
    private readonly memberService: MemberService,
    private readonly chatService: ChatService,
    private readonly rbacService: RbacService,
  ) {}

  async getFeed(
    chapterId: string,
    userId: string,
    limit = DEFAULT_LIMIT,
  ): Promise<ActivityFeedItem[]> {
    const cappedLimit = Math.max(1, Math.min(limit, MAX_LIMIT));

    // One membership read + one identity batch, shared by the roster map
    // (backwork/announcement actor lookups) and the "new member" items —
    // rather than each fetching the whole chapter's membership separately.
    const members = await this.memberService.findRosterWithJoinDates(chapterId);
    const roster = new Map<string, ActivityFeedActor>(
      members.map((member) => [
        member.user_id,
        {
          user_id: member.user_id,
          display_name: member.display_name,
          avatar_url: member.avatar_url,
        },
      ]),
    );

    const domainNames = [
      'events',
      'points',
      'members',
      'announcements',
      'backwork',
    ] as const;
    const domains = await Promise.allSettled([
      this.eventItems(chapterId, userId),
      this.pointsItems(chapterId, userId),
      Promise.resolve(this.memberItems(members)),
      this.announcementItems(chapterId, userId, roster),
      this.backworkItems(chapterId, userId, roster),
    ]);

    const items = domains.flatMap((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      this.logger.warn(
        `Activity feed domain '${domainNames[index]}' failed for chapter ${chapterId}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`,
      );
      return [];
    });

    return topByDate(items, (item) => item.timestamp, cappedLimit);
  }

  /**
   * `viewerId` is not optional here, unlike on `findByChapter` itself: the feed
   * emits `title: event.name` and `body: event.location` for every event it
   * returns, so calling without a viewer republishes a role-targeted event's
   * name and location to members `GET /v1/events/:id` returns 404 to. This
   * route is gated on `members:view` — the same permission the role-filtered
   * `GET /v1/events` requires — so the gate above is not a substitute for the
   * filter. See `spec/behavior/events.md` § Role-based required attendance.
   */
  private async eventItems(
    chapterId: string,
    viewerId: string,
  ): Promise<ActivityFeedItem[]> {
    const events = await this.eventService.findByChapter(chapterId, viewerId);
    const now = Date.now();
    const createdCutoff = now - EVENT_CREATED_LOOKBACK_MS;

    const upcoming = topByDate(
      events.filter((event) => new Date(event.start_time).getTime() > now),
      (event) => event.start_time,
      PER_DOMAIN_LIMIT,
      true,
    ).map((event): ActivityFeedItem => ({
      id: `event_upcoming:${event.id}`,
      type: 'event_upcoming',
      timestamp: event.start_time,
      title: event.name,
      body: event.location,
      actor: null,
      target_id: event.id,
    }));

    // A recurring event's future occurrences are regenerated (fresh
    // `created_at`) whenever the series is edited — excluding anything with a
    // `parent_event_id` keeps a time nudge on a weekly meeting from flooding
    // the feed with rows that read as newly created but weren't, from a
    // member's perspective.
    const created = topByDate(
      events.filter(
        (event) =>
          !event.parent_event_id &&
          new Date(event.created_at).getTime() > createdCutoff,
      ),
      (event) => event.created_at,
      PER_DOMAIN_LIMIT,
    ).map((event): ActivityFeedItem => ({
      id: `event_created:${event.id}`,
      type: 'event_created',
      timestamp: event.created_at,
      title: event.name,
      body: event.location,
      actor: null,
      target_id: event.id,
    }));

    return [...upcoming, ...created];
  }

  private async pointsItems(
    chapterId: string,
    userId: string,
  ): Promise<ActivityFeedItem[]> {
    const { transactions } = await this.pointsService.getUserSummary(
      chapterId,
      userId,
      'all',
    );
    return topByDate(
      transactions,
      (txn) => txn.created_at,
      PER_DOMAIN_LIMIT,
    ).map((txn): ActivityFeedItem => ({
      id: `points_change:${txn.id}`,
      type: 'points_change',
      timestamp: txn.created_at,
      title:
        txn.amount >= 0
          ? `+${txn.amount} points awarded`
          : `${txn.amount} points deducted`,
      body: txn.description || null,
      actor: null,
      target_id: txn.id,
    }));
  }

  // No I/O — `members` is already fetched — so this stays a plain sync
  // method; the call site wraps it in `Promise.resolve()` to match the other
  // domain methods' `Promise<...>` for `Promise.allSettled`.
  private memberItems(
    members: Awaited<ReturnType<MemberService['findRosterWithJoinDates']>>,
  ): ActivityFeedItem[] {
    return topByDate(
      members,
      (member) => member.joined_at,
      PER_DOMAIN_LIMIT,
    ).map((member): ActivityFeedItem => ({
      id: `member_joined:${member.user_id}`,
      type: 'member_joined',
      timestamp: member.joined_at,
      title: `${member.display_name || 'A new member'} joined the chapter`,
      body: null,
      actor: {
        user_id: member.user_id,
        display_name: member.display_name,
        avatar_url: member.avatar_url,
      },
      target_id: member.user_id,
    }));
  }

  private async announcementItems(
    chapterId: string,
    userId: string,
    roster: Map<string, ActivityFeedActor>,
  ): Promise<ActivityFeedItem[]> {
    // Resolved the same way the chat sidebar resolves the caller's visible
    // channel list — never a direct `chat_messages` scan keyed on a channel
    // name, which would bypass `assertChannelAccess` entirely. The
    // name+flags heuristic itself mirrors `ChatService`'s own
    // `sendMessageNotification` (chat.service.ts) — an officer renaming the
    // seeded channel silently drops this domain from the feed, the same
    // accepted risk that heuristic already carries elsewhere in the app.
    const channels = await this.chatService.getChannels(chapterId, userId);
    const announcementChannel = channels.find(
      (channel) =>
        channel.type === 'PUBLIC' &&
        channel.is_read_only &&
        channel.name.toLowerCase().includes('announcements'),
    );
    if (!announcementChannel) return [];

    // Over-fetch before filtering: `getMessages` applies its `limit` at the
    // SQL level with no `is_deleted` predicate (deleted rows stay in place so
    // chat threads can render a "[message deleted]" placeholder), so asking
    // for exactly PER_DOMAIN_LIMIT and filtering afterward could hand back
    // fewer live announcements than actually exist — or none, if the newest
    // PER_DOMAIN_LIMIT rows all happen to be deleted. The buffer trades one
    // slightly larger read for not silently under-reporting a channel's
    // actual recent activity.
    const messages = await this.chatService.getMessages(
      announcementChannel.id,
      chapterId,
      userId,
      { limit: PER_DOMAIN_LIMIT * ANNOUNCEMENT_FETCH_BUFFER },
    );

    return messages
      .filter((message) => !message.is_deleted)
      .slice(0, PER_DOMAIN_LIMIT)
      .map((message): ActivityFeedItem => ({
        id: `announcement:${message.id}`,
        type: 'announcement',
        timestamp: message.created_at,
        title: `New in #${announcementChannel.name}`,
        body: message.content,
        actor: message.sender_id
          ? actorFromRoster(message.sender_id, roster)
          : message.author_name
            ? {
                user_id: '',
                display_name: message.author_name,
                avatar_url: null,
              }
            : null,
        target_id: announcementChannel.id,
      }));
  }

  private async backworkItems(
    chapterId: string,
    userId: string,
    roster: Map<string, ActivityFeedActor>,
  ): Promise<ActivityFeedItem[]> {
    const permissions = await this.rbacService.getEffectivePermissions(
      chapterId,
      userId,
    );
    const canViewBackwork =
      can(SystemPermissions.BACKWORK_UPLOAD, permissions) ||
      can(SystemPermissions.BACKWORK_ADMIN, permissions);
    if (!canViewBackwork) return [];

    const resources = await this.backworkService.findByChapter(chapterId);
    return topByDate(
      resources,
      (resource) => resource.created_at,
      PER_DOMAIN_LIMIT,
    ).map((resource): ActivityFeedItem => ({
      id: `backwork_upload:${resource.id}`,
      type: 'backwork_upload',
      timestamp: resource.created_at,
      title: resource.title || 'New resource uploaded',
      body: null,
      actor: actorFromRoster(resource.uploader_id, roster),
      target_id: resource.id,
    }));
  }
}
