import { Inject, Injectable, Logger } from '@nestjs/common';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { Event } from '#domain/entities/event.entity';
import { isRecurrenceRule } from '@repo/validation';
import { NotificationService } from './notification.service';
import type { NotifyPayload, NotifyRecipient } from './notification.service';
import { ChatService } from './chat.service';
import { RbacService } from './rbac.service';
import { memberAttendance } from './event-role-targeting';
import type { EventAttendanceStatus as EventAttendance } from '@repo/validation';
import type { CreateEventInput, UpdateEventInput } from './event-input';
import {
  DEFAULT_PUSH_TIME_ZONE,
  formatEventWhen,
  joinFacts,
} from './push-copy';
import { logThrowable } from '../../infrastructure/observability/log-throwable';
import { reportCaughtFailure } from '../../infrastructure/observability/report-caught-failure';

/** What an edit moved that members are told about. */
export type EventChange = 'time' | 'place' | 'time_and_place';

/** A location as a member would compare it: blank is none. */
function placeOf(location: string | null | undefined): string | null {
  const trimmed = location?.trim();
  return trimmed ? trimmed : null;
}

function sameInstant(a: string, b: string): boolean {
  return new Date(a).getTime() === new Date(b).getTime();
}

/**
 * Which of when and where `patch` actually moves on `before`, or null when it
 * moves neither. Compares values, not key presence: both clients round-trip
 * the whole event, so a rename arrives carrying the same times and location,
 * and announcing that as "rescheduled" would push the whole chapter for a typo
 * fix. Instants are compared as instants (`+00:00` vs `Z` is no change), and a
 * new recurrence pattern counts as a change of time.
 */
export function eventChangeOf(
  before: Pick<
    Event,
    'start_time' | 'end_time' | 'location' | 'recurrence_rule'
  >,
  patch: Pick<
    UpdateEventInput,
    'start_time' | 'end_time' | 'location' | 'recurrence_rule'
  >,
): EventChange | null {
  const time =
    (patch.start_time !== undefined &&
      !sameInstant(patch.start_time, before.start_time)) ||
    (patch.end_time !== undefined &&
      !sameInstant(patch.end_time, before.end_time)) ||
    (patch.recurrence_rule !== undefined &&
      (patch.recurrence_rule ?? null) !== (before.recurrence_rule ?? null));
  const place =
    patch.location !== undefined &&
    placeOf(patch.location) !== placeOf(before.location);
  if (time && place) return 'time_and_place';
  if (time) return 'time';
  if (place) return 'place';
  return null;
}

/**
 * What the chapter hears about an event write: the new-event and
 * rescheduled pushes and the `/event` chat card. Every one of these is a best-effort
 * side effect of a committed row — the row is the source of truth, so nothing
 * here ever rolls a write back. Split out of `EventService` (#3270).
 */
@Injectable()
export class EventAnnouncementService {
  private readonly logger = new Logger(EventAnnouncementService.name);

  constructor(
    @Inject(USER_REPOSITORY) private readonly userRepo: IUserRepository,
    @Inject(MEMBER_REPOSITORY) private readonly memberRepo: IMemberRepository,
    private readonly notificationService: NotificationService,
    private readonly chatService: ChatService,
    private readonly rbac: RbacService,
  ) {}

  /**
   * Announce a newly scheduled event to everyone it is for, except whoever
   * scheduled it. Silent priority, and best-effort: a failed push never fails
   * the create. A series is announced once, as its pattern, never once per
   * occurrence (`create` calls this for the parent only).
   *
   * Each member reads the event's own name as the title and, in the body,
   * whether it is required of *them*, when it is in their own zone, and where:
   * "Chapter" / "Required · Mon, Nov 9, 8–9 PM · The Lodge"
   * (`spec/behavior/notifications.md` § What a push says).
   */
  async notifyEventCreated(
    chapterId: string,
    event: Event,
    actorId?: string,
  ): Promise<void> {
    try {
      await this.notifyAudience(
        chapterId,
        event,
        actorId,
        'SILENT',
        (copy) => ({
          title: event.name,
          body: joinFacts(
            attendanceLabel(copy.attendance),
            copy.when,
            event.location,
          ),
        }),
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'event-created-announce-failed',
        message: `Failed to send the new event push (event ${event.id}, chapter ${chapterId})`,
        error,
      });
    }
  }

  /**
   * Returns whether the card posted, or `undefined` when no card was due —
   * the three-way distinction `card_posted` publishes.
   *
   * channel_id and client_message_id are paired (the optimistic placeholder
   * is keyed on client_message_id). If only one is supplied the card is
   * skipped and the client's placeholder would hang — surface that, and omit
   * the flag: no card was attempted.
   */
  async tryPostEventCard(
    input: CreateEventInput,
    parent: Event,
  ): Promise<boolean | undefined> {
    if (Boolean(input.channel_id) !== Boolean(input.client_message_id)) {
      this.logger.warn(
        'Event card not posted: channel_id and client_message_id must be supplied together',
        { chapterId: input.chapter_id, eventId: parent.id },
      );
    }
    if (!input.channel_id || !input.client_message_id || !input.created_by) {
      return undefined;
    }

    try {
      await this.postEventCard(input, parent);
      return true;
    } catch (error) {
      logThrowable(
        this.logger,
        'warn',
        `Failed to post event card to chat (event ${parent.id}, channel ${input.channel_id}, chapter ${input.chapter_id})`,
        error,
      );
      return false;
    }
  }

  /**
   * Post the `kind:"event"` card for a committed event. The creator's name is
   * resolved here and the details embedded in the payload so the snapshot stays
   * a correct record even if the event is later edited. The card carries the
   * event id; the renderer reads the live attendance count back through the
   * attendance query (the chat message row is never mutated). Posts as the
   * creator into the channel they ran the command from; channel access is
   * re-checked by `ChatService.sendMessage`.
   *
   * Only ever reached for an event that invites everyone: `create` rejects
   * one that limits its audience (`eventLimitsAudience`) and asks for a card
   * before writing the row, because this payload is broadcast to every reader
   * of the channel and would bypass the read gate #1463 installed.
   */
  private async postEventCard(
    input: CreateEventInput,
    event: Event,
  ): Promise<void> {
    const createdBy = input.created_by!;
    const users = await this.userRepo.findByIds([createdBy]);
    const creatorName =
      users.find((u) => u.id === createdBy)?.display_name ?? 'Unknown member';

    const payload = {
      event_id: event.id,
      name: event.name,
      start_time: event.start_time,
      end_time: event.end_time,
      location: event.location ?? null,
      point_value: event.point_value,
      is_mandatory: event.is_mandatory,
      created_at: event.created_at,
    };

    // The server has no creator-timezone context, so render the snapshot time
    // explicitly in UTC (labelled) rather than the API host's local zone. This
    // string is only the fallback shown when the rich renderer can't read the
    // payload; the event card itself localises start_time per viewer.
    const startLabel = new Date(event.start_time).toLocaleString('en-US', {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    });
    const locationSuffix = event.location ? ` at ${event.location}` : '';
    const content = `${creatorName} scheduled "${event.name}" — ${startLabel} UTC${locationSuffix}`;

    await this.chatService.sendMessage({
      chapter_id: input.chapter_id,
      channel_id: input.channel_id!,
      sender_id: createdBy,
      content,
      kind: 'event',
      payload,
      client_message_id: input.client_message_id,
      system_originated: true,
    });
  }

  /**
   * Announce an edit that changes where or when members need to be, to
   * everyone the event is for, except whoever made the edit. Silent for
   * cosmetic edits, and best-effort: the row is the source of truth, so a
   * failed push never rolls the update back.
   *
   * "Chapter rescheduled" / "Now Tue, Nov 10, 8–9 PM · Required", or
   * "Chapter moved" / "Now at The Lodge · Mon, Nov 9, 8–9 PM". A series edit
   * is one push naming the new pattern.
   */
  async notifyEventUpdated(
    chapterId: string,
    updated: Event,
    change: EventChange | null,
    actorId?: string,
  ): Promise<void> {
    if (!change) return;
    try {
      await this.notifyAudience(
        chapterId,
        updated,
        actorId,
        'NORMAL',
        ({ when, attendance }) => {
          if (change === 'place') {
            return {
              title: `${updated.name} moved`,
              body: joinFacts(
                updated.location
                  ? `Now at ${updated.location}`
                  : 'No location set now',
                when,
                attendanceLabel(attendance),
              ),
            };
          }
          return {
            title: `${updated.name} rescheduled`,
            body: joinFacts(
              `Now ${lowerFirst(when)}`,
              change === 'time_and_place' &&
                (updated.location ? `at ${updated.location}` : null),
              attendanceLabel(attendance),
            ),
          };
        },
      );
    } catch (error) {
      reportCaughtFailure(this.logger, {
        level: 'error',
        site: 'event-updated-announce-failed',
        message: `Failed to send the rescheduled event push (event ${updated.id}, chapter ${chapterId})`,
        error,
      });
    }
  }

  /**
   * Send `copy` to every member the event is for, with what it asks of each
   * of them, leaving out `actorId`: whoever scheduled or moved it already
   * knows, and a push about your own action reads as noise.
   *
   * The audience follows the event's read rule (attendance by role): a member
   * the event does not invite is left out; without that, the push named a
   * role-targeted event (and deep-linked to it) for every member, even one who
   * correctly 404s reading the event itself (#1463).
   */
  private async notifyAudience(
    chapterId: string,
    event: Event,
    actorId: string | undefined,
    priority: NotifyPayload['priority'],
    write: (copy: { attendance: EventAttendance; when: string }) => {
      title: string;
      body: string;
    },
  ): Promise<void> {
    const [members, alumniRoleId, actorZone] = await Promise.all([
      this.memberRepo.findByChapter(chapterId),
      // Only the Required/Optional label for alumni depends on it, so a
      // failed read costs that label, never the push.
      this.rbac.getAlumniRoleId(chapterId).catch(() => null),
      actorId ? this.notificationService.timeZoneFor(actorId) : null,
    ]);

    const attendanceByUser = new Map<string, EventAttendance>();
    for (const member of members) {
      if (member.user_id === actorId) continue;
      const attendance = memberAttendance(event, member.role_ids, alumniRoleId);
      if (attendance !== 'not_invited') {
        attendanceByUser.set(member.user_id, attendance);
      }
    }
    if (attendanceByUser.size === 0) return;

    const recurrence = isRecurrenceRule(event.recurrence_rule)
      ? event.recurrence_rule
      : null;
    // A recipient with no zone of their own reads the event in its
    // scheduler's zone (members share a campus), labelled, so a guess is never
    // presented as their own clock.
    const when = (recipient: NotifyRecipient | null): string =>
      formatEventWhen(event.start_time, event.end_time, {
        timeZone: recipient?.timeZone ?? actorZone ?? DEFAULT_PUSH_TIME_ZONE,
        labelZone: !recipient?.timeZone,
        recurrence,
      });

    const payload: NotifyPayload = {
      // What a caller that cannot personalize would show; every recipient
      // here reads their own `personalize` result instead.
      ...write({ attendance: 'optional', when: when(null) }),
      priority,
      category: 'events',
      data: { target: { screen: 'events', eventId: event.id } },
      personalize: (recipient) =>
        write({
          attendance: attendanceByUser.get(recipient.userId) ?? 'optional',
          when: when(recipient),
        }),
    };
    await this.notificationService.notifyMembers(
      chapterId,
      [...attendanceByUser.keys()],
      payload,
    );
  }
}

/** "Required" / "Optional": the first thing a member needs to know. */
function attendanceLabel(attendance: EventAttendance): string | null {
  switch (attendance) {
    case 'required':
      return 'Required';
    case 'optional':
      return 'Optional';
    case 'not_invited':
      return null;
  }
}

/** "Mon, Nov 9" stays; "Every Mon" reads "every Mon" after "Now". */
function lowerFirst(text: string): string {
  return text.startsWith('Every') || text.startsWith('Monthly')
    ? text.charAt(0).toLowerCase() + text.slice(1)
    : text;
}
