import { Inject, Injectable, Logger } from '@nestjs/common';
import { USER_REPOSITORY } from '#domain/repositories/user.repository.interface';
import type { IUserRepository } from '#domain/repositories/user.repository.interface';
import { MEMBER_REPOSITORY } from '#domain/repositories/member.repository.interface';
import type { IMemberRepository } from '#domain/repositories/member.repository.interface';
import { Event } from '#domain/entities/event.entity';
import { NotificationService } from './notification.service';
import type { NotifyPayload } from './notification.service';
import { ChatService } from './chat.service';
import { hasRequiredRole } from './event-role-targeting';
import type { CreateEventInput, UpdateEventInput } from './event-input';
import { logThrowable } from '../../infrastructure/observability/log-throwable';

/**
 * What the chapter hears about an event write: the "New Event" / "Event
 * Updated" pushes and the `/event` chat card. Every one of these is a best-effort
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
  ) {}

  /**
   * Announce a newly scheduled event. Silent priority, and best-effort: a
   * failed push never fails the create.
   */
  async notifyEventCreated(chapterId: string, event: Event): Promise<void> {
    try {
      await this.notifyEligibleMembers(chapterId, event.required_role_ids, {
        title: 'New Event',
        body: `${event.name} has been scheduled`,
        priority: 'SILENT',
        category: 'events',
        data: { target: { screen: 'events', eventId: event.id } },
      });
    } catch {}
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
   * Only ever reached for an **untargeted** event: `create` rejects a
   * role-targeted event that asks for a card before writing the row, because
   * this payload is broadcast to every reader of the channel and would bypass
   * the `required_role_ids` read gate #1463 installed.
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
   * Announce an edit that changes where or when members need to be. Silent for
   * cosmetic edits, and best-effort: the row is the source of truth, so a failed
   * push never rolls the update back.
   */
  async notifyEventUpdated(
    chapterId: string,
    updated: Event,
    input: UpdateEventInput,
  ): Promise<void> {
    if (!input.start_time && !input.end_time && input.location === undefined) {
      return;
    }
    try {
      await this.notifyEligibleMembers(chapterId, updated.required_role_ids, {
        title: 'Event Updated',
        body: `${updated.name} has been updated`,
        priority: 'NORMAL',
        category: 'events',
        data: { target: { screen: 'events', eventId: updated.id } },
      });
    } catch {}
  }

  /**
   * Chapter-wide notification, unless the event is role-targeted — then only
   * members whose `role_ids` intersect `required_role_ids` are notified.
   * Without this, `notifyChapter`'s "New Event"/"Event Updated" push still
   * named a role-targeted event (and deep-linked to it) for every member,
   * even one who now correctly 404s reading the event itself (#1463).
   */
  private async notifyEligibleMembers(
    chapterId: string,
    requiredRoleIds: string[] | null | undefined,
    payload: NotifyPayload,
  ): Promise<void> {
    if (!requiredRoleIds || requiredRoleIds.length === 0) {
      await this.notificationService.notifyChapter(chapterId, payload);
      return;
    }
    const members = await this.memberRepo.findByChapter(chapterId);
    const eligible = members.filter((member) =>
      hasRequiredRole(requiredRoleIds, member.role_ids),
    );
    await Promise.allSettled(
      eligible.map((member) =>
        this.notificationService.notifyUser(member.user_id, chapterId, payload),
      ),
    );
  }
}
