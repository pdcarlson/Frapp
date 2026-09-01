import { Injectable } from '@nestjs/common';
import { can } from '@repo/validation';
import { EventService } from './event.service';
import { PointsService } from './points.service';
import { BackworkService } from './backwork.service';
import { MemberService } from './member.service';
import { ChatService } from './chat.service';
import { RbacService } from './rbac.service';
import { SystemPermissions } from '../../domain/constants/permissions';

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
/** "New event created" only surfaces events created within this window — otherwise a chapter's entire history reads as "new" forever. */
const EVENT_CREATED_LOOKBACK_MS = 14 * 24 * 60 * 60 * 1000;

function actorFromRoster(
  userId: string | null | undefined,
  roster: Map<string, ActivityFeedActor>,
): ActivityFeedActor | null {
  if (!userId) return null;
  return roster.get(userId) ?? null;
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
 */
@Injectable()
export class ActivityFeedService {
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

    const roster = new Map(
      (await this.memberService.findRosterByChapter(chapterId)).map(
        (entry) => [entry.user_id, entry] as const,
      ),
    );

    const [events, points, members, announcements, backwork] =
      await Promise.all([
        this.eventItems(chapterId),
        this.pointsItems(chapterId, userId),
        this.memberItems(chapterId),
        this.announcementItems(chapterId, userId, roster),
        this.backworkItems(chapterId, userId, roster),
      ]);

    return [...events, ...points, ...members, ...announcements, ...backwork]
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp))
      .slice(0, cappedLimit);
  }

  private async eventItems(chapterId: string): Promise<ActivityFeedItem[]> {
    const events = await this.eventService.findByChapter(chapterId);
    const now = Date.now();
    const createdCutoff = now - EVENT_CREATED_LOOKBACK_MS;

    const upcoming = events
      .filter((event) => new Date(event.start_time).getTime() > now)
      .sort(
        (a, b) =>
          new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
      )
      .slice(0, PER_DOMAIN_LIMIT)
      .map((event): ActivityFeedItem => ({
        id: `event_upcoming:${event.id}`,
        type: 'event_upcoming',
        timestamp: event.start_time,
        title: event.name,
        body: event.location,
        actor: null,
        target_id: event.id,
      }));

    const created = events
      .filter((event) => new Date(event.created_at).getTime() > createdCutoff)
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, PER_DOMAIN_LIMIT)
      .map((event): ActivityFeedItem => ({
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
    return [...transactions]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, PER_DOMAIN_LIMIT)
      .map((txn): ActivityFeedItem => ({
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

  private async memberItems(chapterId: string): Promise<ActivityFeedItem[]> {
    const joins = await this.memberService.findRecentJoins(
      chapterId,
      PER_DOMAIN_LIMIT,
    );
    return joins.map((join): ActivityFeedItem => ({
      id: `member_joined:${join.user_id}`,
      type: 'member_joined',
      timestamp: join.joined_at,
      title: `${join.display_name || 'A new member'} joined the chapter`,
      body: null,
      actor: {
        user_id: join.user_id,
        display_name: join.display_name,
        avatar_url: join.avatar_url,
      },
      target_id: join.user_id,
    }));
  }

  private async announcementItems(
    chapterId: string,
    userId: string,
    roster: Map<string, ActivityFeedActor>,
  ): Promise<ActivityFeedItem[]> {
    // Resolved the same way the chat sidebar resolves the caller's visible
    // channel list — never a direct `chat_messages` scan keyed on a channel
    // name, which would bypass `assertChannelAccess` entirely.
    const channels = await this.chatService.getChannels(chapterId, userId);
    const announcementChannel = channels.find(
      (channel) =>
        channel.type === 'PUBLIC' &&
        channel.is_read_only &&
        channel.name.toLowerCase().includes('announcements'),
    );
    if (!announcementChannel) return [];

    const messages = await this.chatService.getMessages(
      announcementChannel.id,
      chapterId,
      userId,
      { limit: PER_DOMAIN_LIMIT },
    );

    return messages.map((message): ActivityFeedItem => ({
      id: `announcement:${message.id}`,
      type: 'announcement',
      timestamp: message.created_at,
      title: `New in #${announcementChannel.name}`,
      body: message.content,
      actor: message.sender_id
        ? (roster.get(message.sender_id) ?? null)
        : message.author_name
          ? { user_id: '', display_name: message.author_name, avatar_url: null }
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
    return [...resources]
      .sort(
        (a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
      )
      .slice(0, PER_DOMAIN_LIMIT)
      .map((resource): ActivityFeedItem => ({
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
