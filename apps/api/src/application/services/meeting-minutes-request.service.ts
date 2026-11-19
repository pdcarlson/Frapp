import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { STANDARDS_MEETING_TYPE, type MeetingType } from '@repo/validation';
import { MEETING_REPOSITORY } from '#domain/repositories/meeting.repository.interface';
import type { IMeetingRepository } from '#domain/repositories/meeting.repository.interface';
import { MEETING_MINUTES_REQUEST_REPOSITORY } from '#domain/repositories/meeting-minutes-request.repository.interface';
import type { IMeetingMinutesRequestRepository } from '#domain/repositories/meeting-minutes-request.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Event } from '#domain/entities/event.entity';
import { SystemPermissions, WILDCARD } from '#domain/constants/permissions';
import { EventService } from './event.service';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';

/** At most one ping per meeting this often, however many members ask. */
export const MINUTES_REQUEST_COOLDOWN_SECONDS = 24 * 60 * 60;

/** One meeting's unposted minutes the caller may ask for. */
export interface MinutesRequestState {
  meeting_id: string;
  event_id: string;
  /** The caller has asked already. */
  requested: boolean;
}

type Askable =
  | { ok: true; event: Event }
  | { ok: false; reason: 'hidden' | 'posted' | 'not_over' };

/**
 * A member asks for minutes that haven't been posted (#5471,
 * `spec/behavior/meetings.md` § Asking for minutes), which pings whoever
 * can post them.
 *
 * Who may ask: a member the meeting's event shows itself to, once the event
 * has ended, while its minutes are an unposted draft the member can't open
 * (not its author, no `meetings:edit`). They learn only that unposted
 * minutes exist, never what they say. Standards minutes can't be asked for.
 *
 * The spam guard is the database's (`request_meeting_minutes`): each member
 * asks once per meeting, and a meeting pings at most once a day; asks the
 * guard held back are counted into the next ping.
 */
@Injectable()
export class MeetingMinutesRequestService {
  constructor(
    @Inject(MEETING_REPOSITORY)
    private readonly meetingRepo: IMeetingRepository,
    @Inject(MEETING_MINUTES_REQUEST_REPOSITORY)
    private readonly requests: IMeetingMinutesRequestRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly events: EventService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * The event's unposted minutes, when the caller may ask for them: one row
   * or none. A caller the event leaves out, or who can open the draft, gets
   * none, the same as an event with no minutes.
   */
  async state(
    chapterId: string,
    userId: string,
    eventId: string,
  ): Promise<MinutesRequestState[]> {
    const meeting = await this.meetingRepo.findByEvent(chapterId, eventId);
    if (!meeting) return [];
    const askable = await this.askable(chapterId, meeting, userId);
    if (!askable.ok) return [];
    return [
      {
        meeting_id: meeting.id,
        event_id: askable.event.id,
        requested: await this.requests.hasRequested(
          chapterId,
          meeting.id,
          userId,
        ),
      },
    ];
  }

  /**
   * Records the caller's ask, and pings whoever can post the minutes when
   * the guard allows. Asking twice changes nothing and is not an error.
   */
  async request(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<MinutesRequestState> {
    const meeting = await this.meetingRepo.findById(chapterId, meetingId);
    if (!meeting) throw new NotFoundException('Minutes not found');
    const askable = await this.askable(chapterId, meeting, userId);
    if (!askable.ok) {
      if (askable.reason === 'posted') {
        throw new ConflictException({
          code: 'meeting.already_posted',
          message: 'These minutes are already posted.',
        });
      }
      if (askable.reason === 'not_over') {
        throw new ConflictException({
          code: 'meeting.not_over',
          message: 'You can ask for the minutes once the meeting has ended.',
        });
      }
      // The same 404 as a missing id, so a member the event leaves out
      // can't learn that it has minutes.
      throw new NotFoundException('Minutes not found');
    }
    const outcome = await this.requests.request(
      chapterId,
      meeting.id,
      userId,
      MINUTES_REQUEST_COOLDOWN_SECONDS,
    );
    if (outcome.ping) {
      await this.ping(chapterId, meeting, askable.event, userId, outcome.asked);
    }
    return { meeting_id: meeting.id, event_id: askable.event.id, requested: true };
  }

  private async askable(
    chapterId: string,
    meeting: Meeting,
    userId: string,
  ): Promise<Askable> {
    if (!meeting.event_id) return { ok: false, reason: 'hidden' };
    // Never offered: Standards minutes are refused at every step (§ Standards).
    if (meeting.meeting_type === (STANDARDS_MEETING_TYPE as MeetingType)) {
      return { ok: false, reason: 'hidden' };
    }
    const event = await this.visibleEvent(chapterId, meeting.event_id, userId);
    if (!event) return { ok: false, reason: 'hidden' };
    if (meeting.status === 'posted') return { ok: false, reason: 'posted' };
    // The author and editors open the draft themselves.
    if (meeting.created_by === userId) return { ok: false, reason: 'hidden' };
    if (await this.canEditAny(chapterId, userId)) {
      return { ok: false, reason: 'hidden' };
    }
    if (Date.parse(event.end_time) > Date.now()) {
      return { ok: false, reason: 'not_over' };
    }
    return { ok: true, event };
  }

  /**
   * Pings who can post the minutes: their author while still a member the
   * event shows itself to; otherwise the event's creator, by the same test;
   * otherwise the `meetings:edit` holders. Never the member asking. The ping
   * names who asked and opens the event, and the draft too for someone who
   * can open it.
   */
  private async ping(
    chapterId: string,
    meeting: Meeting,
    event: Event,
    askerId: string,
    asked: number,
  ): Promise<void> {
    const identities =
      await this.memberRepo.findChapterMemberIdentities(chapterId);
    const names = new Map(
      identities.map((member) => [member.user_id, member.display_name]),
    );
    const takes = async (candidate: string | null) =>
      !!candidate &&
      candidate !== askerId &&
      names.has(candidate) &&
      (await this.visibleEvent(chapterId, event.id, candidate)) !== null;

    let recipients: { userId: string; canOpen: boolean }[];
    if (await takes(meeting.created_by)) {
      recipients = [{ userId: meeting.created_by!, canOpen: true }];
    } else if (await takes(event.created_by)) {
      recipients = [
        {
          userId: event.created_by!,
          canOpen: await this.canEditAny(chapterId, event.created_by!),
        },
      ];
    } else {
      recipients = (
        await this.rbac.findUserIdsWithPermissions(chapterId, [
          SystemPermissions.MEETINGS_EDIT,
        ])
      )
        .filter((id) => id !== askerId)
        .map((id) => ({ userId: id, canOpen: true }));
    }
    if (recipients.length === 0) return;

    const body = minutesRequestedBody(
      names.get(askerId)?.trim() || 'A member',
      asked,
      event.name,
    );
    for (const canOpen of [true, false]) {
      const userIds = recipients
        .filter((recipient) => recipient.canOpen === canOpen)
        .map((recipient) => recipient.userId);
      if (userIds.length === 0) continue;
      await this.notifications.notifyMembers(chapterId, userIds, {
        title: 'Minutes requested',
        body,
        category: 'events',
        priority: 'NORMAL',
        data: {
          target: canOpen
            ? { screen: 'events', eventId: event.id, meetingId: meeting.id }
            : { screen: 'events', eventId: event.id },
        },
      });
    }
  }

  /** The event as `userId` may read it; null when it doesn't show to them. */
  private async visibleEvent(
    chapterId: string,
    eventId: string,
    userId: string,
  ): Promise<Event | null> {
    return this.events
      .findById(eventId, chapterId, userId)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
  }

  private async canEditAny(chapterId: string, userId: string) {
    const held = await this.rbac.getEffectivePermissions(chapterId, userId);
    return held.includes(WILDCARD) || held.includes(SystemPermissions.MEETINGS_EDIT);
  }
}

/**
 * "Shawn asked for the minutes from Chapter meeting." or, for a ping that
 * speaks for several members, "Shawn and 2 others asked…".
 */
export function minutesRequestedBody(
  askerName: string,
  asked: number,
  eventName: string,
): string {
  const others = Math.max(0, asked - 1);
  const who =
    others === 0
      ? askerName
      : `${askerName} and ${others} ${others === 1 ? 'other' : 'others'}`;
  return `${who} asked for the minutes from ${eventName}. Post them when they're ready.`;
}
