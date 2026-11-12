import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  EVENT_EXCUSE_LATE_HOURS,
  checkInWindowBounds,
  eventExcuseClosesAt,
} from '@repo/validation';
import { EVENT_EXCUSE_REPOSITORY } from '#domain/repositories/event-excuse.repository.interface';
import type { IEventExcuseRepository } from '#domain/repositories/event-excuse.repository.interface';
import { EVENT_REPOSITORY } from '#domain/repositories/event.repository.interface';
import type { IEventRepository } from '#domain/repositories/event.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { ATTENDANCE_REPOSITORY } from '#domain/repositories/attendance.repository.interface';
import type { IAttendanceRepository } from '#domain/repositories/attendance.repository.interface';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import type { Event } from '#domain/entities/event.entity';
import type { EventExcuse } from '#domain/entities/event-excuse.entity';
import { SystemPermissions } from '#domain/constants/permissions';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';
import { AttendanceService } from './attendance.service';
import { NotificationService } from './notification.service';
import { RbacService } from './rbac.service';
import { isEventVisibleTo } from './event-role-targeting';

/** Who an excuse goes to, as the member sees it ("Excuse sent to Jake"). */
export interface ExcuseReceiver {
  user_id: string;
  display_name: string;
}

/** An excuse with its sender's name, for the receiver's list. */
export interface EventExcuseWithMember extends EventExcuse {
  display_name: string;
}

/**
 * Absence excuses for required events (#3735; `spec/behavior/events.md`
 * § Excuses).
 *
 * A member the event requires sends one line any time before the event and up
 * to `EVENT_EXCUSE_LATE_HOURS` after it ends. It goes to the event's creator
 * (or, when the creator can't act on it or sent it, to every `events:update`
 * holder), who approves or declines it; anyone with `events:update` may decide
 * too. Approving writes attendance EXCUSED, and the auto-absent sweep skips a
 * pending or approved excuse (`AttendanceService.markAutoAbsent`).
 */
@Injectable()
export class EventExcuseService {
  private readonly logger = new Logger(EventExcuseService.name);

  constructor(
    @Inject(EVENT_EXCUSE_REPOSITORY)
    private readonly excuseRepo: IEventExcuseRepository,
    @Inject(EVENT_REPOSITORY)
    private readonly eventRepo: IEventRepository,
    @Inject(MEMBER_REPOSITORY)
    private readonly memberRepo: IMemberRepository,
    @Inject(ATTENDANCE_REPOSITORY)
    private readonly attendanceRepo: IAttendanceRepository,
    @Inject(USER_REPOSITORY)
    private readonly userRepo: IUserRepository,
    private readonly attendance: AttendanceService,
    private readonly rbac: RbacService,
    private readonly notifications: NotificationService,
  ) {}

  /**
   * The event, or the same 404 a nonexistent id gets when the caller can't
   * see it (`isEventVisibleTo`), so no excuse route confirms a role-targeted
   * event exists.
   */
  private async visibleEvent(
    eventId: string,
    chapterId: string,
    userId: string,
  ): Promise<Event> {
    const event = await this.eventRepo.findById(eventId, chapterId);
    if (
      !event ||
      !(await isEventVisibleTo(event, chapterId, userId, {
        rbac: this.rbac,
        memberRepo: this.memberRepo,
      }))
    ) {
      throw new NotFoundException('Event not found');
    }
    return event;
  }

  /**
   * The event's creator, while they can act on its excuses: still a member of
   * its chapter, and able to see the event (`isEventVisibleTo`). A creator who
   * lost `events:update` and isn't invited to their own role-limited event
   * would get the 404 every excuse route answers, so they don't receive it.
   */
  private async actingCreator(
    event: Event,
    chapterId: string,
  ): Promise<string | null> {
    const creator = event.created_by;
    if (!creator) return null;
    const member = await this.memberRepo.findByUserAndChapter(
      creator,
      chapterId,
    );
    if (!member) return null;
    const sees = await isEventVisibleTo(event, chapterId, creator, {
      rbac: this.rbac,
      memberRepo: this.memberRepo,
    });
    return sees ? creator : null;
  }

  private officerIds(chapterId: string): Promise<string[]> {
    return this.rbac.findUserIdsWithPermissions(chapterId, [
      SystemPermissions.EVENTS_UPDATE,
    ]);
  }

  /**
   * Who is told about excuses from `senderIds`: the acting creator for every
   * sender but themselves, and the `events:update` holders when there is no
   * acting creator or the creator is among the senders (nobody decides their
   * own without `events:update`). Never a sender about their own excuse alone.
   */
  private async receiverIds(
    event: Event,
    chapterId: string,
    senderIds: readonly string[],
  ): Promise<string[]> {
    const creator = await this.actingCreator(event, chapterId);
    const others = senderIds.filter((id) => id !== creator);
    const receivers = new Set<string>();
    if (creator && others.length > 0) receivers.add(creator);
    if (!creator || others.length < senderIds.length) {
      for (const id of await this.officerIds(chapterId)) receivers.add(id);
    }
    // A sender is told only when someone else's excuse also waits on them.
    if (senderIds.length === 1) receivers.delete(senderIds[0]);
    return [...receivers];
  }

  /**
   * Whether `userId` may decide excuses for `event`: its acting creator, or
   * anyone with `events:update`. Nobody decides their own, unless they hold
   * `events:update` (an officer can already mark themselves excused).
   */
  private async canDecide(
    event: Event,
    chapterId: string,
    userId: string,
    excuseUserId?: string,
  ): Promise<boolean> {
    const officer = await this.rbac.memberHasAnyPermission(chapterId, userId, [
      SystemPermissions.EVENTS_UPDATE,
    ]);
    if (officer) return true;
    if (event.created_by !== userId || excuseUserId === userId) return false;
    return (await this.actingCreator(event, chapterId)) === userId;
  }

  private async displayNames(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await this.userRepo.findDisplayIdentitiesByIds([
      ...new Set(ids),
    ]);
    return new Map(users.map((u) => [u.id, u.display_name]));
  }

  async submit(
    eventId: string,
    userId: string,
    chapterId: string,
    reason: string,
  ): Promise<EventExcuse> {
    const event = await this.visibleEvent(eventId, chapterId, userId);

    const member = await this.memberRepo.findByUserAndChapter(
      userId,
      chapterId,
    );
    if (
      !member ||
      !(await this.attendance.requiresMember(chapterId, event, member.role_ids))
    ) {
      throw new BadRequestException(
        'You can only send an excuse for an event you are required to attend',
      );
    }

    if (new Date() > eventExcuseClosesAt(new Date(event.end_time))) {
      throw new BadRequestException(
        `Excuses for this event closed ${EVENT_EXCUSE_LATE_HOURS} hours after it ended`,
      );
    }

    const existing = await this.attendanceRepo.findByEventAndUser(
      eventId,
      userId,
    );
    if (existing?.status === 'PRESENT' || existing?.status === 'LATE') {
      throw new ConflictException('You already checked in to this event');
    }
    if (existing?.status === 'EXCUSED') {
      throw new ConflictException('You are already excused from this event');
    }
    if (existing?.status === 'ABSENT' && existing.marked_by) {
      // An officer's decision, not the sweep's: an approval may not reverse
      // it (`decide_event_excuse`), so an excuse would ask for nothing.
      throw new ConflictException(
        'An officer marked you absent from this event; ask them to change it',
      );
    }

    const excuse = await this.excuseRepo.create({
      chapter_id: event.chapter_id,
      event_id: eventId,
      user_id: userId,
      reason: reason.trim(),
    });
    if (!excuse) {
      throw new ConflictException('You already sent an excuse for this event');
    }

    await this.notifyReceivers(event, chapterId, excuse);
    return excuse;
  }

  /** The caller's own excuse for an event, and who it goes to. */
  async getMine(
    eventId: string,
    userId: string,
    chapterId: string,
  ): Promise<{ excuse: EventExcuse | null; receiver: ExcuseReceiver | null }> {
    const event = await this.visibleEvent(eventId, chapterId, userId);
    const [excuse, creator] = await Promise.all([
      this.excuseRepo.findByEventAndUser(chapterId, eventId, userId),
      this.actingCreator(event, chapterId),
    ]);
    // Nobody sends an excuse to themselves: their own event's goes to the
    // officers, which the clients word without a name.
    if (!creator || creator === userId) return { excuse, receiver: null };
    const names = await this.displayNames([creator]);
    const name = names.get(creator);
    return {
      excuse,
      receiver: name ? { user_id: creator, display_name: name } : null,
    };
  }

  /**
   * Take back a pending or approved excuse, while check-in is still open:
   * after that the event is over, the sweep has counted the member by their
   * excuse, and the receiver's decision stands.
   */
  async withdraw(
    eventId: string,
    userId: string,
    chapterId: string,
  ): Promise<void> {
    const event = await this.visibleEvent(eventId, chapterId, userId);

    const excuse = await this.excuseRepo.findByEventAndUser(
      chapterId,
      eventId,
      userId,
    );
    if (!excuse) {
      throw new NotFoundException('You have no excuse for this event');
    }
    if (excuse.status === 'DECLINED') {
      throw new ConflictException('A declined excuse cannot be withdrawn');
    }

    const { closesAt } = checkInWindowBounds(
      new Date(event.start_time),
      new Date(event.end_time),
      event.check_in_opens_minutes,
    );
    if (new Date() > closesAt) {
      throw new ConflictException(
        'This event is over, so the excuse can no longer be withdrawn',
      );
    }

    const withdrawn = await this.excuseRepo.withdrawAtomic(
      chapterId,
      eventId,
      userId,
    );
    if (!withdrawn) {
      throw new ConflictException(
        'This excuse was decided or withdrawn in the meantime',
      );
    }
  }

  /** Every excuse for the event, for whoever may decide them. */
  async list(
    eventId: string,
    chapterId: string,
    callerId: string,
  ): Promise<EventExcuseWithMember[]> {
    const event = await this.visibleEvent(eventId, chapterId, callerId);
    if (!(await this.canDecide(event, chapterId, callerId))) {
      throw new ForbiddenException(
        'Only the event creator or an officer who can edit events sees its excuses',
      );
    }
    // Only current members: an excuse outlives its sender's membership (the
    // row cascades with the user, not the member), and is no longer anyone's
    // to decide.
    const [all, members] = await Promise.all([
      this.excuseRepo.findByEvent(chapterId, eventId),
      this.memberRepo.findByChapter(chapterId),
    ]);
    const memberIds = new Set(members.map((m) => m.user_id));
    const excuses = all.filter((e) => memberIds.has(e.user_id));
    const names = await this.displayNames(excuses.map((e) => e.user_id));
    return excuses.map((e) => ({
      ...e,
      display_name: names.get(e.user_id) ?? '',
    }));
  }

  async decide(
    eventId: string,
    excuseUserId: string,
    chapterId: string,
    deciderId: string,
    decision: 'APPROVED' | 'DECLINED',
  ): Promise<EventExcuse> {
    const event = await this.visibleEvent(eventId, chapterId, deciderId);
    if (!(await this.canDecide(event, chapterId, deciderId, excuseUserId))) {
      throw new ForbiddenException(
        'Only the event creator or an officer who can edit events decides its excuses',
      );
    }

    const excuse = await this.excuseRepo.findByEventAndUser(
      chapterId,
      eventId,
      excuseUserId,
    );
    if (!excuse) {
      throw new NotFoundException('Excuse not found');
    }
    if (excuse.status !== 'PENDING') {
      throw new ConflictException('This excuse has already been decided');
    }

    const sender = await this.memberRepo.findByUserAndChapter(
      excuseUserId,
      chapterId,
    );
    if (!sender) {
      throw new ConflictException('This member is no longer in the chapter');
    }
    const attendance = await this.attendanceRepo.findByEventAndUser(
      eventId,
      excuseUserId,
    );
    if (attendance?.status === 'PRESENT' || attendance?.status === 'LATE') {
      // Check-in drops a pending excuse; this is the race with it.
      throw new ConflictException('This member checked in to the event');
    }
    if (
      decision === 'APPROVED' &&
      attendance?.status === 'ABSENT' &&
      attendance.marked_by
    ) {
      throw new ConflictException(
        'An officer marked this member absent; change their attendance instead',
      );
    }

    // The sweep runs once per event, at the close of check-in, and skipped
    // this member while the excuse was pending. A decline after that counts
    // them as the sweep would have, which means only while the event still
    // requires them; before it, the sweep will.
    const { closesAt } = checkInWindowBounds(
      new Date(event.start_time),
      new Date(event.end_time),
      event.check_in_opens_minutes,
    );
    const markAbsent =
      decision === 'DECLINED' &&
      new Date() >= closesAt &&
      (await this.attendance.requiresMember(chapterId, event, sender.role_ids));

    const decided = await this.excuseRepo.decideAtomic(
      excuse.id,
      chapterId,
      decision,
      deciderId,
      markAbsent,
    );
    if (!decided) {
      throw new ConflictException(
        'This excuse was decided or withdrawn in the meantime',
      );
    }

    await this.notifyDecision(event, chapterId, decided, markAbsent);
    return decided;
  }

  /**
   * After the sweep: one reminder to the receivers of an event that still has
   * excuses waiting. Called once per event, by the auto-absent sweep after its
   * claim. Best-effort, like every notification here.
   */
  async remindPending(eventId: string, chapterId: string): Promise<void> {
    try {
      const event = await this.eventRepo.findById(eventId, chapterId);
      if (!event) return;
      const pending = await this.excuseRepo.findUserIdsByEventAndStatus(
        chapterId,
        eventId,
        ['PENDING'],
      );
      if (pending.length === 0) return;
      const receivers = await this.receiverIds(event, chapterId, pending);
      if (receivers.length === 0) return;
      const count = pending.length;
      await this.notifications.notifyMembers(chapterId, receivers, {
        title: 'Excuses waiting',
        body:
          count === 1
            ? `1 excuse for ${event.name} still needs a decision.`
            : `${count} excuses for ${event.name} still need a decision.`,
        priority: 'NORMAL',
        category: 'events',
        data: { target: { screen: 'events', eventId } },
      });
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'event-excuse-remind-pending',
        message: `Could not remind receivers of pending excuses for event ${eventId}`,
        error,
      });
    }
  }

  private async notifyReceivers(
    event: Event,
    chapterId: string,
    excuse: EventExcuse,
  ): Promise<void> {
    try {
      const receivers = await this.receiverIds(event, chapterId, [
        excuse.user_id,
      ]);
      if (receivers.length === 0) return;
      const names = await this.displayNames([excuse.user_id]);
      const sender = names.get(excuse.user_id) || 'A member';
      await this.notifications.notifyMembers(chapterId, receivers, {
        title: `${sender} can't make ${event.name}`,
        body: excuse.reason,
        priority: 'NORMAL',
        category: 'events',
        data: { target: { screen: 'events', eventId: event.id } },
      });
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'event-excuse-submitted-notify',
        message: `Could not notify the receivers of excuse ${excuse.id}`,
        error,
      });
    }
  }

  private async notifyDecision(
    event: Event,
    chapterId: string,
    excuse: EventExcuse,
    markedAbsent: boolean,
  ): Promise<void> {
    const approved = excuse.status === 'APPROVED';
    try {
      await this.notifications.notifyUser(excuse.user_id, chapterId, {
        title: approved ? 'Excused' : 'Excuse not accepted',
        body: approved
          ? `You're excused from ${event.name}.`
          : markedAbsent
            ? `You're marked absent for ${event.name}.`
            : `You're still expected at ${event.name}.`,
        priority: 'NORMAL',
        category: 'events',
        data: { target: { screen: 'events', eventId: event.id } },
      });
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'warning',
        site: 'event-excuse-decided-notify',
        message: `Could not tell member ${excuse.user_id} that excuse ${excuse.id} was decided`,
        error,
      });
    }
  }
}
