import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { STANDARDS_MEETING_TYPE, type MeetingType } from '@repo/validation';
import { MEETING_MINUTES_REQUEST_REPOSITORY } from '#domain/repositories/meeting-minutes-request.repository.interface';
import type { IMeetingMinutesRequestRepository } from '#domain/repositories/meeting-minutes-request.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import type { Meeting } from '#domain/entities/meeting.entity';
import type { Event } from '#domain/entities/event.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { toReportableError } from '../../infrastructure/observability/reportable-error';
import { EventService } from './event.service';
import { MeetingService } from './meeting.service';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';

/** At most one reminder per meeting this often, however many members ask. */
export const MINUTES_REQUEST_COOLDOWN_SECONDS = 24 * 60 * 60;

/** One meeting's unposted minutes the caller may ask for. */
export interface MinutesRequestState {
  meeting_id: string;
  event_id: string;
  /** The caller has asked already. */
  requested: boolean;
}

/** What asking did. */
export interface MinutesRequestSent extends MinutesRequestState {
  /**
   * This ask sent a reminder. False when the guard held it back: whoever is
   * writing them was already reminded within the day.
   */
  pinged: boolean;
}

type Askable =
  | { ok: true; event: Event }
  | { ok: false; reason: 'hidden' | 'posted' | 'not_over' };

/**
 * A member asks for minutes that haven't been posted (#5471,
 * `spec/behavior/meetings.md` § Asking for minutes), which reminds whoever
 * can post them.
 *
 * Who may ask: a member the meeting's event shows itself to, once the event
 * has ended, while its minutes are an unposted draft the member can't open
 * (`MeetingService.canRead`, the one read rule for minutes). They learn only
 * that unposted minutes exist, never what they say. Standards minutes can't
 * be asked for.
 *
 * The spam guard is the database's (`request_meeting_minutes`): each member
 * asks once per meeting, and a meeting sends at most one reminder a day; an
 * ask the guard holds back is counted into the next reminder, if one goes
 * out. A reminder that can't be sent is undone (`release`), so it never
 * silences the meeting for a day.
 */
@Injectable()
export class MeetingMinutesRequestService {
  private readonly logger = new Logger(MeetingMinutesRequestService.name);

  constructor(
    @Inject(MEETING_MINUTES_REQUEST_REPOSITORY)
    private readonly requests: IMeetingMinutesRequestRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly meetings: MeetingService,
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
    const [meeting] = await this.meetings.draftsVisibleTo(
      chapterId,
      userId,
      eventId,
    );
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
   * Records the caller's ask, and reminds whoever can post the minutes when
   * the guard allows. Asking twice changes nothing and is not an error.
   */
  async request(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<MinutesRequestSent> {
    const { meeting } = await this.meetings.noteTakingView(
      chapterId,
      meetingId,
      userId,
    );
    const askable = await this.askable(chapterId, meeting, userId);
    if (!askable.ok) throw refusal(askable.reason);
    const { event } = askable;
    const outcome = await this.requests.request(
      chapterId,
      meeting.id,
      userId,
      MINUTES_REQUEST_COOLDOWN_SECONDS,
    );
    const sent = { meeting_id: meeting.id, event_id: event.id };
    if (!outcome.requested) {
      // Asked before, or posted (or deleted) since `askable` read them.
      if (await this.requests.hasRequested(chapterId, meeting.id, userId)) {
        return { ...sent, requested: true, pinged: false };
      }
      throw refusal('posted');
    }
    if (!outcome.ping) return { ...sent, requested: true, pinged: false };
    try {
      await this.ping(chapterId, meeting, event, userId, outcome.asked);
    } catch (error) {
      await this.release(chapterId, meeting.id, userId);
      // A 5xx: the exception filter reports it, with this cause.
      throw new ServiceUnavailableException(
        {
          code: 'meeting.request_not_sent',
          message: 'The reminder couldn’t be sent. Try again in a moment.',
        },
        { cause: toReportableError(error) },
      );
    }
    return { ...sent, requested: true, pinged: true };
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
    if (!(await this.meetings.eventShowsTo(chapterId, meeting, userId))) {
      return { ok: false, reason: 'hidden' };
    }
    if (meeting.status === 'posted') return { ok: false, reason: 'posted' };
    // The author and editors open the draft themselves.
    if (await this.meetings.canRead(chapterId, meeting.id, userId)) {
      return { ok: false, reason: 'hidden' };
    }
    const event = await this.events
      .findById(meeting.event_id, chapterId)
      .catch((error: unknown) => {
        if (error instanceof NotFoundException) return null;
        throw error;
      });
    if (!event) return { ok: false, reason: 'hidden' };
    if (Date.parse(event.end_time) > Date.now()) {
      return { ok: false, reason: 'not_over' };
    }
    return { ok: true, event };
  }

  /**
   * Reminds who can post the minutes: their author while still a member the
   * event shows itself to; otherwise the event's creator, by the same test;
   * otherwise the `meetings:edit` holders. Never the member asking. The
   * reminder names who asked and opens the event, and the draft too for
   * someone who can open it.
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
    const takes = async (candidate: string | null): Promise<boolean> =>
      !!candidate &&
      candidate !== askerId &&
      names.has(candidate) &&
      (await this.meetings.eventShowsTo(chapterId, meeting, candidate));

    let recipients: { userId: string; canOpen: boolean }[];
    if (await takes(meeting.created_by)) {
      recipients = [{ userId: meeting.created_by!, canOpen: true }];
    } else if (await takes(event.created_by)) {
      recipients = [
        {
          userId: event.created_by!,
          canOpen: await this.meetings.canRead(
            chapterId,
            meeting.id,
            event.created_by!,
          ),
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

  /** Undoes the guard's record of a reminder that wasn't sent. */
  private async release(
    chapterId: string,
    meetingId: string,
    userId: string,
  ): Promise<void> {
    try {
      await this.requests.release(chapterId, meetingId, userId);
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'meeting-minutes-request-release',
        message: `minutes ${meetingId} hold a reminder that was never sent`,
        error,
      });
    }
  }
}

function refusal(reason: 'hidden' | 'posted' | 'not_over'): Error {
  if (reason === 'posted') {
    return new ConflictException({
      code: 'meeting.already_posted',
      message: 'These minutes are already posted.',
    });
  }
  if (reason === 'not_over') {
    return new ConflictException({
      code: 'meeting.not_over',
      message: 'You can ask for the minutes once the meeting has ended.',
    });
  }
  // The same 404 as a missing id, so a member the event leaves out can't
  // learn that it has minutes.
  return new NotFoundException('Minutes not found');
}

/**
 * "Shawn asked for the minutes from Chapter meeting." or, for a reminder that
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
